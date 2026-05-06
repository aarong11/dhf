import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalize, parseDescription, type SemanticGrammar } from './grammar.js';
import { derive, derivePartial, prefixMatch } from './derive.js';
import { SemanticAddress } from './address.js';
import { AddressBook } from './book.js';

describe('normalize', () => {
  it('produces identical output regardless of input order', () => {
    const a: SemanticGrammar = { entity: 'Route', domain: 'reasoning', qualifier: 'urgent' };
    const b: SemanticGrammar = { qualifier: 'urgent', domain: 'reasoning', entity: 'Route' };
    const [normA] = normalize(a);
    const [normB] = normalize(b);
    assert.equal(normA, normB);
  });

  it('normalizes case and whitespace', () => {
    const a: SemanticGrammar = { domain: '  REASONING  ', entity: 'Route  Planning' };
    const [norm] = normalize(a);
    assert.equal(norm, 'domain=reasoning>entity=route planning');
  });

  it('sorts multi-value facets', () => {
    const a: SemanticGrammar = { domain: ['navigation', 'reasoning'] };
    const b: SemanticGrammar = { domain: ['reasoning', 'navigation'] };
    const [normA] = normalize(a);
    const [normB] = normalize(b);
    assert.equal(normA, normB);
    assert.equal(normA, 'domain=navigation,reasoning');
  });

  it('reports depth correctly', () => {
    const [, depth] = normalize({ domain: 'x', entity: 'y', relation: 'z' });
    assert.equal(depth, 3);
  });
});

describe('derive', () => {
  it('produces 32-byte addresses', () => {
    const addr = derive({ domain: 'reasoning', entity: 'test' }, 'hello world');
    assert.equal(addr.bytes.length, 32);
  });

  it('same grammar + same content = same address', () => {
    const g: SemanticGrammar = { domain: 'reasoning', entity: 'planning' };
    const a = derive(g, 'content A');
    const b = derive(g, 'content A');
    assert.equal(a.toHex(), b.toHex());
  });

  it('same grammar + different content = same prefix, different address', () => {
    const g: SemanticGrammar = { domain: 'reasoning', entity: 'planning' };
    const a = derive(g, 'content A');
    const b = derive(g, 'content B');
    // Prefix (first 8 bytes for domain+entity) should match
    assert.deepEqual(a.prefix(2), b.prefix(2));
    // Full address differs (content fingerprint)
    assert.notEqual(a.toHex(), b.toHex());
  });

  it('encodes depth correctly', () => {
    const addr = derive({ domain: 'x', entity: 'y', relation: 'z' }, 'test');
    assert.equal(addr.depth, 3);
  });
});

describe('derivePartial', () => {
  it('produces prefix bytes equal to depth * 4', () => {
    const partial = derivePartial({ domain: 'reasoning', entity: 'planning' });
    assert.equal(partial.bytes.length, 8); // 2 facets * 4 bytes
    assert.equal(partial.depth, 2);
  });

  it('stops at first missing facet (contiguous prefix)', () => {
    // entity present but domain missing → partial should be empty (domain is first)
    const partial = derivePartial({ entity: 'planning' } as SemanticGrammar);
    // domain is first in order, entity second — if domain is missing, prefix stops at 0
    assert.equal(partial.depth, 0);
  });

  it('partial prefix matches full address with same leading grammar', () => {
    const grammar: SemanticGrammar = { domain: 'reasoning', entity: 'planning', relation: 'depends-on' };
    const full = derive(grammar, 'some content');
    const partial = derivePartial({ domain: 'reasoning', entity: 'planning' });

    assert.equal(prefixMatch(full, partial), true);
  });

  it('partial prefix does NOT match address with different domain', () => {
    const full = derive({ domain: 'perception', entity: 'planning' }, 'content');
    const partial = derivePartial({ domain: 'reasoning' });

    assert.equal(prefixMatch(full, partial), false);
  });
});

describe('AddressBook', () => {
  it('query by partial address returns matching entries', () => {
    const book = new AddressBook<string>();

    // Store multiple memories in the "reasoning" domain
    const g1: SemanticGrammar = { domain: 'reasoning', entity: 'planning', relation: 'depends-on' };
    const g2: SemanticGrammar = { domain: 'reasoning', entity: 'planning', relation: 'supports' };
    const g3: SemanticGrammar = { domain: 'reasoning', entity: 'debugging' };
    const g4: SemanticGrammar = { domain: 'perception', entity: 'vision' };

    book.put(derive(g1, 'memory 1'), 'memory 1');
    book.put(derive(g2, 'memory 2'), 'memory 2');
    book.put(derive(g3, 'memory 3'), 'memory 3');
    book.put(derive(g4, 'memory 4'), 'memory 4');

    // Query with just domain → should get all "reasoning" memories
    const domainOnly = derivePartial({ domain: 'reasoning' });
    const domainResults = book.query(domainOnly);
    assert.equal(domainResults.length, 3); // g1, g2, g3

    // Query with domain+entity → should narrow to "reasoning:planning"
    const domainEntity = derivePartial({ domain: 'reasoning', entity: 'planning' });
    const narrowResults = book.query(domainEntity);
    assert.equal(narrowResults.length, 2); // g1, g2

    // Query with all three levels → exact neighborhood
    const precise = derivePartial({ domain: 'reasoning', entity: 'planning', relation: 'depends-on' });
    const preciseResults = book.query(precise);
    assert.equal(preciseResults.length, 1); // g1 only
  });

  it('hex prefix query works for partial address resolution', () => {
    const book = new AddressBook<string>();

    const g1: SemanticGrammar = { domain: 'reasoning', entity: 'test' };
    const addr = derive(g1, 'hello');
    book.put(addr, 'found it');

    // Get the first 4 bytes (domain segment) as hex
    const domainHex = addr.toShortString(1); // First segment
    // Query by that hex prefix — simulates "I have a partial address, find the rest"
    const results = book.queryByHexPrefix(addr.toHex().slice(0, 8));
    assert.equal(results.length, 1);
    assert.equal(results[0]!.value, 'found it');
  });
});

describe('parseDescription', () => {
  it('extracts domain from natural language', () => {
    const g = parseDescription('I was thinking about this problem');
    assert.equal(g.domain, 'reasoning');
  });

  it('extracts temporal markers', () => {
    const g = parseDescription('something that happened recently');
    assert.equal(g.temporal, 'recent');
  });

  it('same meaning different phrasing → same normalized address', () => {
    // Both describe reasoning about navigation, recently, high priority
    const g1 = { domain: 'reasoning', entity: 'navigation', temporal: 'recent', qualifier: 'high-priority' };
    const g2 = { domain: 'reasoning', entity: 'navigation', qualifier: 'high-priority', temporal: 'recent' };

    const addr1 = derive(g1, '');
    const addr2 = derive(g2, '');

    // Same grammar (regardless of property order) → same prefix
    assert.deepEqual(addr1.prefix(4), addr2.prefix(4));
  });
});
