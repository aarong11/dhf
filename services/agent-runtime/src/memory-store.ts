/**
 * Distributed memory store backed by hippocampus-dag.
 *
 * Memories are addressed using the semantic-address scheme:
 *   domain > entity > relation > temporal > qualifier
 *
 * Each memory is stored at its derived 32-byte address. Retrieval supports
 * partial prefix queries — "give me everything in reasoning:planning" —
 * which route through the distributed DAG network.
 *
 * Locally, an AddressBook serves as a routing cache. For writes, the store
 * PUTs to hippocampus-dag. For reads, it issues prefix queries that the
 * DAG nodes resolve by scanning their address space.
 */

import {
  derive,
  derivePartial,
  AddressBook,
  SemanticAddress,
  normalize,
  parseDescription,
  type SemanticGrammar,
  type PartialAddress,
} from '@ecca/semantic-address';

export interface MemoryEntry {
  /** Unique semantic address. */
  address: string;
  /** The grammar that produced this address. */
  grammar: SemanticGrammar;
  /** The stored content. */
  content: string;
  /** Embedding vector (optional — for similarity search fallback). */
  embedding?: number[];
  /** Unix timestamp of creation. */
  createdAt: number;
  /** Last access timestamp (for recency-weighted recall). */
  accessedAt: number;
  /** Relevance score from last query (transient). */
  score?: number;
}

export interface MemoryQuery {
  /** Semantic grammar for prefix-based lookup. */
  grammar?: SemanticGrammar;
  /** Raw text to parse into a grammar (uses parseDescription). */
  text?: string;
  /** Maximum results to return. */
  limit?: number;
  /** Minimum depth for prefix matching (1-5). */
  minDepth?: number;
}

export interface StoreConfig {
  /** Hippocampus-DAG HTTP endpoint. */
  hippocampusUrl: string;
  /** How many results to return by default. */
  defaultLimit: number;
  /** Whether to maintain a local address book cache. */
  localCache: boolean;
}

const DEFAULT_CONFIG: StoreConfig = {
  hippocampusUrl: process.env.HIPPOCAMPUS_URL ?? 'http://hippocampus-dag:5001',
  defaultLimit: 20,
  localCache: true,
};

export class MemoryStore {
  private config: StoreConfig;
  private cache: AddressBook<MemoryEntry>;

  constructor(config?: Partial<StoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new AddressBook<MemoryEntry>();
  }

  /**
   * Store a memory at its semantic address.
   * The content is hashed with the grammar to produce a unique address.
   * The entry is PUT to hippocampus-dag and cached locally.
   */
  async store(grammar: SemanticGrammar, content: string, embedding?: number[]): Promise<MemoryEntry> {
    const address = derive(grammar, content);
    const now = Date.now();

    const entry: MemoryEntry = {
      address: address.toHex(),
      grammar,
      content,
      embedding,
      createdAt: now,
      accessedAt: now,
    };

    // PUT to hippocampus-dag
    await this.dagPut(address, entry);

    // Cache locally
    if (this.config.localCache) {
      this.cache.put(address, entry);
    }

    return entry;
  }

  /**
   * Recall memories by semantic prefix.
   * Partial grammars give you broad neighborhood queries.
   * Full grammars give you precise matches.
   */
  async recall(query: MemoryQuery): Promise<MemoryEntry[]> {
    const limit = query.limit ?? this.config.defaultLimit;
    let grammar = query.grammar;

    if (!grammar && query.text) {
      grammar = parseDescription(query.text);
    }

    if (!grammar) return [];

    const partial = derivePartial(grammar);

    // Try local cache first
    if (this.config.localCache) {
      const cached = this.cache.query(partial);
      if (cached.length > 0) {
        const results = cached
          .map(e => { e.value.accessedAt = Date.now(); return e.value; })
          .slice(0, limit);
        return results;
      }
    }

    // Query hippocampus-dag via prefix
    const results = await this.dagQuery(partial, limit);

    // Populate cache
    if (this.config.localCache) {
      for (const entry of results) {
        this.cache.put(SemanticAddress.fromHex(entry.address), entry);
      }
    }

    return results;
  }

  /**
   * Get a single memory by its exact address (hex string).
   */
  async get(hex: string): Promise<MemoryEntry | undefined> {
    if (this.config.localCache) {
      const cached = this.cache.getByHex(hex);
      if (cached) { cached.accessedAt = Date.now(); return cached; }
    }
    return this.dagGet(hex);
  }

  /** Number of locally cached entries. */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ─── DAG transport layer ────────────────────────────────────────────

  private async dagPut(address: SemanticAddress, entry: MemoryEntry): Promise<void> {
    const url = `${this.config.hippocampusUrl}/api/v1/put`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: address.toHex(),
        depth: address.depth,
        data: entry,
      }),
    });
    if (!resp.ok) {
      throw new Error(`hippocampus PUT failed: ${resp.status} ${await resp.text()}`);
    }
  }

  private async dagQuery(partial: PartialAddress, limit: number): Promise<MemoryEntry[]> {
    const url = `${this.config.hippocampusUrl}/api/v1/query`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: partial.hex,
        depth: partial.depth,
        facets: partial.facets,
        limit,
      }),
    });
    if (!resp.ok) return [];
    const body = await resp.json() as { entries: MemoryEntry[] };
    return body.entries ?? [];
  }

  private async dagGet(hex: string): Promise<MemoryEntry | undefined> {
    const url = `${this.config.hippocampusUrl}/api/v1/get/${hex}`;
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    return (await resp.json()) as MemoryEntry;
  }
}
