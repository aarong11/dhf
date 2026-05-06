import { sha256 } from '@noble/hashes/sha256';
import { normalize, FACET_ORDER, type SemanticGrammar } from './grammar.js';

/** A full 32-byte semantic address: 20 bytes prefix tree + 12 bytes content fingerprint. */
export class SemanticAddress {
  /** The raw 32-byte address. */
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    if (bytes.length !== 32) throw new Error(`SemanticAddress must be 32 bytes, got ${bytes.length}`);
    this.bytes = bytes;
  }

  /** Number of prefix levels present (1-5). A depth of 0 means only content hash. */
  get depth(): number {
    // Depth is encoded in the last nibble of byte 20
    return this.bytes[20]! & 0x0f;
  }

  /** Extract the prefix at a given level (0-indexed, 0=domain). Returns 4 bytes per level. */
  segment(level: number): Uint8Array {
    if (level < 0 || level >= 5) throw new RangeError('Level must be 0-4');
    return this.bytes.slice(level * 4, (level + 1) * 4);
  }

  /** Get the routing prefix up to a given depth (inclusive). */
  prefix(depth: number): Uint8Array {
    if (depth < 1 || depth > 5) throw new RangeError('Depth must be 1-5');
    return this.bytes.slice(0, depth * 4);
  }

  /** Hex string representation. */
  toHex(): string {
    return Array.from(this.bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** Short prefix for display (first N segments as hex, separated by colons). */
  toShortString(depth?: number): string {
    const d = depth ?? this.depth;
    const segs: string[] = [];
    for (let i = 0; i < d && i < 5; i++) {
      const seg = this.segment(i);
      segs.push(Array.from(seg).map(b => b.toString(16).padStart(2, '0')).join(''));
    }
    return segs.join(':');
  }

  /** Check if this address starts with the given partial address prefix. */
  startsWith(partial: PartialAddress): boolean {
    const prefixBytes = partial.bytes;
    if (prefixBytes.length > this.bytes.length) return false;
    for (let i = 0; i < prefixBytes.length; i++) {
      if (this.bytes[i] !== prefixBytes[i]) return false;
    }
    return true;
  }

  static fromHex(hex: string): SemanticAddress {
    if (hex.length !== 64) throw new Error(`Expected 64 hex chars, got ${hex.length}`);
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return new SemanticAddress(bytes);
  }
}

/**
 * A partial address — a prefix of a semantic address with fewer than 5 levels.
 * Used for querying: "give me everything in this region of the address space."
 */
export interface PartialAddress {
  /** The prefix bytes (4 * depth). */
  bytes: Uint8Array;
  /** How many facet levels this prefix covers. */
  depth: number;
  /** Which facets are represented. */
  facets: string[];
  /** Hex representation. */
  hex: string;
}
