import { sha256 } from '@noble/hashes/sha256';
import { normalize, FACET_ORDER, type SemanticGrammar } from './grammar.js';
import { SemanticAddress, type PartialAddress } from './address.js';

/**
 * Derive a full 32-byte semantic address from a grammar and content.
 *
 * Structure (32 bytes total):
 *   [0..3]   domain segment   — hash of "domain=<normalized-value>"
 *   [4..7]   entity segment   — hash of "entity=<normalized-value>"
 *   [8..11]  relation segment — hash of "relation=<normalized-value>"
 *   [12..15] temporal segment — hash of "temporal=<normalized-value>"
 *   [16..19] qualifier segment— hash of "qualifier=<normalized-value>"
 *   [20]     depth nibble (low) + flags (high)
 *   [21..31] content fingerprint (11 bytes of sha256 of content)
 *
 * Missing facets get zeroed segments — they still occupy space so that
 * prefix alignment is maintained. The depth nibble tells you how many
 * leading segments are meaningful for routing.
 *
 * @param grammar The semantic grammar describing this memory
 * @param content The actual content being stored (for fingerprint uniqueness)
 */
export function derive(grammar: SemanticGrammar, content: string | Uint8Array): SemanticAddress {
  const addr = new Uint8Array(32);
  let depth = 0;

  // Hash each facet into its 4-byte segment
  for (let i = 0; i < FACET_ORDER.length; i++) {
    const facet = FACET_ORDER[i]!;
    const raw = grammar[facet];
    if (raw === undefined || raw === null) {
      // Leave zeros — maintains alignment
      continue;
    }

    const values = Array.isArray(raw) ? raw : [raw];
    const normalized = values
      .map(v => v.toLowerCase().trim().replace(/\s+/g, ' '))
      .filter(v => v.length > 0)
      .sort();

    if (normalized.length === 0) continue;

    // Hash the facet string to get 4 bytes
    const facetStr = `${facet}=${normalized.join(',')}`;
    const hash = sha256(new TextEncoder().encode(facetStr));
    addr.set(hash.slice(0, 4), i * 4);
    depth = i + 1; // Depth = highest filled level + 1
  }

  // Byte 20: depth in low nibble
  addr[20] = depth & 0x0f;

  // Bytes 21-31: content fingerprint (11 bytes)
  const contentBytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;
  const contentHash = sha256(contentBytes);
  addr.set(contentHash.slice(0, 11), 21);

  return new SemanticAddress(addr);
}

/**
 * Derive a partial address from an incomplete grammar.
 * Returns only the prefix segments that are present — used for querying.
 *
 * A partial address with depth=2 means "I know the domain and entity but nothing else."
 * Querying a node with this prefix returns all memories in that domain+entity region.
 */
export function derivePartial(grammar: SemanticGrammar): PartialAddress {
  const segments: Uint8Array[] = [];
  const facets: string[] = [];

  for (const facet of FACET_ORDER) {
    const raw = grammar[facet];
    if (raw === undefined || raw === null) break; // Stop at first gap — prefix must be contiguous

    const values = Array.isArray(raw) ? raw : [raw];
    const normalized = values
      .map(v => v.toLowerCase().trim().replace(/\s+/g, ' '))
      .filter(v => v.length > 0)
      .sort();

    if (normalized.length === 0) break;

    const facetStr = `${facet}=${normalized.join(',')}`;
    const hash = sha256(new TextEncoder().encode(facetStr));
    segments.push(hash.slice(0, 4));
    facets.push(facet);
  }

  const bytes = new Uint8Array(segments.length * 4);
  for (let i = 0; i < segments.length; i++) {
    bytes.set(segments[i]!, i * 4);
  }

  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  return { bytes, depth: segments.length, facets, hex };
}

/**
 * Check if a full address matches a partial prefix.
 * Used by nodes to filter their stored memories against a query prefix.
 */
export function prefixMatch(address: SemanticAddress, partial: PartialAddress): boolean {
  if (partial.depth === 0) return true; // Empty prefix matches everything

  for (let i = 0; i < partial.bytes.length; i++) {
    if (address.bytes[i] !== partial.bytes[i]) return false;
  }
  return true;
}

/**
 * Compute the "distance" between two addresses at a given depth.
 * Lower distance = closer in the semantic space at that resolution.
 * Used for routing — find the node whose prefix is closest to the query.
 */
export function prefixDistance(a: SemanticAddress, b: SemanticAddress, depth: number): number {
  let dist = 0;
  const end = Math.min(depth * 4, 20);
  for (let i = 0; i < end; i++) {
    dist += popcount(a.bytes[i]! ^ b.bytes[i]!);
  }
  return dist;
}

function popcount(n: number): number {
  let count = 0;
  while (n) { count += n & 1; n >>>= 1; }
  return count;
}
