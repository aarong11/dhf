import { SemanticAddress, type PartialAddress } from './address.js';
import { prefixMatch } from './derive.js';

/**
 * In-memory address book — indexes semantic addresses for prefix queries.
 * 
 * This is the local index a node maintains. When a query arrives with a
 * partial address (prefix), the book returns all matching entries.
 * 
 * For distributed operation, nodes are responsible for regions of the
 * address space. A node whose own prefix matches a query's prefix
 * serves that query. Partial prefixes with fewer levels hit more nodes
 * (broader queries), while deeper prefixes are more precise.
 */
export class AddressBook<T = unknown> {
  private entries: Map<string, { address: SemanticAddress; value: T }> = new Map();

  /** Store a value at a semantic address. */
  put(address: SemanticAddress, value: T): void {
    this.entries.set(address.toHex(), { address, value });
  }

  /** Get an exact match by full address. */
  get(address: SemanticAddress): T | undefined {
    return this.entries.get(address.toHex())?.value;
  }

  /** Get by hex string. */
  getByHex(hex: string): T | undefined {
    return this.entries.get(hex)?.value;
  }

  /**
   * Query by partial address prefix.
   * Returns all entries whose address starts with the given prefix.
   * 
   * This is the core operation for "give me a rough idea of where to look":
   *   - depth=1 (domain only): broad scan, many results
   *   - depth=2 (domain+entity): narrower
   *   - depth=3+: precise neighborhood
   */
  query(partial: PartialAddress): Array<{ address: SemanticAddress; value: T }> {
    const results: Array<{ address: SemanticAddress; value: T }> = [];
    for (const entry of this.entries.values()) {
      if (prefixMatch(entry.address, partial)) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Query by hex prefix string.
   * Simpler interface — just pass the hex prefix and we match all addresses starting with it.
   */
  queryByHexPrefix(hexPrefix: string): Array<{ address: SemanticAddress; value: T }> {
    const results: Array<{ address: SemanticAddress; value: T }> = [];
    for (const [hex, entry] of this.entries) {
      if (hex.startsWith(hexPrefix)) {
        results.push(entry);
      }
    }
    return results;
  }

  /** Number of entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Remove an entry by address. */
  delete(address: SemanticAddress): boolean {
    return this.entries.delete(address.toHex());
  }

  /** All addresses in this book. */
  addresses(): SemanticAddress[] {
    return Array.from(this.entries.values()).map(e => e.address);
  }
}
