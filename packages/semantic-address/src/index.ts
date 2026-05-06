/**
 * Semantic Address — Hierarchical content-derived addressing for distributed memory.
 *
 * A semantic address is a 32-byte value derived from a normalized constrained grammar
 * that describes what a memory IS (not what it contains). The grammar is:
 *
 *   domain > entity > relation > temporal > qualifier
 *
 * Each level contributes a 4-byte segment (20 bytes total for the prefix tree).
 * The remaining 12 bytes are a content fingerprint for uniqueness.
 *
 * Partial addresses: If you only know domain + entity, you get an 8-byte prefix
 * that routes you to the correct neighborhood. Nodes serve prefix queries —
 * "give me everything under this prefix" — enabling progressive refinement.
 *
 * The grammar is NORMALIZED before hashing:
 *   1. Facets are sorted into canonical order (domain, entity, relation, temporal, qualifier)
 *   2. Within each facet, values are lowercased and whitespace-collapsed
 *   3. Multi-value facets are sorted lexicographically
 *   4. The normalized string is deterministic regardless of input order
 *
 * This means the same semantic description ALWAYS produces the same address,
 * and partial descriptions always produce valid prefixes of the full address.
 */

export { SemanticAddress, type PartialAddress } from './address.js';
export { normalize, parseDescription, type SemanticGrammar, type Facet, FACET_ORDER } from './grammar.js';
export { derive, derivePartial, prefixMatch } from './derive.js';
export { AddressBook } from './book.js';
