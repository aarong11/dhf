import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TokenKind, TokenBalance, CoherenceProfileVector, EpochBindingCurve,
  DEFAULT_BALANCE, TOKEN_CONTRACT_NAMES, effectiveBalance,
} from './tokens.js';

import {
  StackId, SleeveId, Cid, EmbodimentType,
  StackCreated, SleeveSpawned, PerceiveEvent, RecallEvent,
  NeedlecastEvent, EpochTransition, ResidueKind, ResidueKindEnum,
  EccaEvent, SUBJECTS, STREAM_CONFIG,
} from './events.js';

import {
  ECCA, EPOCH_INTERVAL_MS, DRIFT_MAX_DEFAULT, FIDELITY_MIN_DEFAULT,
  CORTEX_CHAIN_ID, SYNAPTIC_FIELD_DEPTH,
  type ContinuityCheck,
} from './index.js';

// ─── TokenKind ─────────────────────────────────────────────────────────────
describe('TokenKind', () => {
  it('validates all five token kinds', () => {
    for (const k of ['compute', 'memory', 'sync', 'routing', 'residue']) {
      assert.doesNotThrow(() => TokenKind.parse(k));
    }
  });

  it('rejects unknown token kinds', () => {
    assert.throws(() => TokenKind.parse('gold'));
  });

  it('maps every kind to a contract name', () => {
    for (const k of TokenKind.options) {
      assert.ok(TOKEN_CONTRACT_NAMES[k], `Missing contract name for ${k}`);
    }
  });
});

// ─── TokenBalance ──────────────────────────────────────────────────────────
describe('TokenBalance', () => {
  it('validates DEFAULT_BALANCE', () => {
    assert.doesNotThrow(() => TokenBalance.parse(DEFAULT_BALANCE));
    assert.equal(DEFAULT_BALANCE.compute, 1000);
    assert.equal(DEFAULT_BALANCE.residue, 0);
  });

  it('rejects negative values', () => {
    assert.throws(() => TokenBalance.parse({ ...DEFAULT_BALANCE, compute: -1 }));
  });
});

// ─── CoherenceProfileVector ────────────────────────────────────────────────
describe('CoherenceProfileVector', () => {
  it('parses with defaults', () => {
    const cpv = CoherenceProfileVector.parse({});
    assert.equal(cpv.computeCoeff, 1);
    assert.equal(cpv.memoryCoeff, 1);
    assert.equal(cpv.syncCoeff, 1);
    assert.equal(cpv.routingCoeff, 1);
    assert.equal(cpv.residueCoeff, 1);
  });

  it('rejects coefficients above 2', () => {
    assert.throws(() => CoherenceProfileVector.parse({ computeCoeff: 3 }));
  });

  it('rejects negative coefficients', () => {
    assert.throws(() => CoherenceProfileVector.parse({ computeCoeff: -0.5 }));
  });
});

// ─── EpochBindingCurve ─────────────────────────────────────────────────────
describe('EpochBindingCurve', () => {
  it('parses with defaults', () => {
    const curve = EpochBindingCurve.parse({});
    assert.equal(curve.decayRate, 0.05);
    assert.equal(curve.floor, 0.25);
  });

  it('rejects decayRate > 1', () => {
    assert.throws(() => EpochBindingCurve.parse({ decayRate: 1.5 }));
  });
});

// ─── effectiveBalance ──────────────────────────────────────────────────────
describe('effectiveBalance', () => {
  const cpv = CoherenceProfileVector.parse({});
  const curve = EpochBindingCurve.parse({});

  it('returns raw balance at epoch 0 (no decay)', () => {
    const eff = effectiveBalance(DEFAULT_BALANCE, cpv, curve, 0);
    assert.equal(eff.compute, 1000);
    assert.equal(eff.memory, 1000);
  });

  it('decays over time but never below floor', () => {
    const eff = effectiveBalance(DEFAULT_BALANCE, cpv, curve, 1000);
    // floor is 0.25, so minimum is 250
    assert.equal(eff.compute, 250);
    assert.ok(eff.compute >= DEFAULT_BALANCE.compute * curve.floor);
  });

  it('applies CPV multipliers', () => {
    const boostCpv = CoherenceProfileVector.parse({ computeCoeff: 2, memoryCoeff: 0.5 });
    const eff = effectiveBalance(DEFAULT_BALANCE, boostCpv, curve, 0);
    assert.equal(eff.compute, 2000);
    assert.equal(eff.memory, 500);
  });

  it('does not decay residue tokens (repair incentive must persist)', () => {
    const raw = { ...DEFAULT_BALANCE, residue: 100 };
    const eff = effectiveBalance(raw, cpv, curve, 1000);
    assert.equal(eff.residue, 100); // residue * 1.0 (cpv) = 100, no decay
  });

  it('handles moderate decay correctly', () => {
    const eff = effectiveBalance(DEFAULT_BALANCE, cpv, curve, 10);
    // exp(-0.05 * 10) = exp(-0.5) ≈ 0.6065
    const expected = 1000 * Math.exp(-0.5);
    assert.ok(Math.abs(eff.compute - expected) < 0.001);
  });
});

// ─── Event ID schemas ──────────────────────────────────────────────────────
describe('Event ID schemas', () => {
  it('validates StackId format', () => {
    assert.doesNotThrow(() => StackId.parse('stack:human:5:c11db171b9ea'));
    assert.throws(() => StackId.parse('bad-id'));
    assert.throws(() => StackId.parse(''));
  });

  it('validates SleeveId format', () => {
    assert.doesNotThrow(() => SleeveId.parse('sleeve:ai:2:caafd6f3'));
    assert.throws(() => SleeveId.parse('stack:human:1:abc'));
  });

  it('validates ECCA CID format', () => {
    const hex64 = 'a'.repeat(64);
    assert.doesNotThrow(() => Cid.parse(`ecca://${hex64}@42`));
    assert.doesNotThrow(() => Cid.parse(`ecca://${hex64}`));
    assert.throws(() => Cid.parse(`ipfs://${hex64}`));
  });

  it('validates EmbodimentType', () => {
    for (const t of ['human', 'ai', 'mining', 'memory']) {
      assert.doesNotThrow(() => EmbodimentType.parse(t));
    }
    assert.throws(() => EmbodimentType.parse('robot'));
  });
});

// ─── ResidueKind ───────────────────────────────────────────────────────────
describe('ResidueKind', () => {
  it('validates all five residue kinds', () => {
    for (const k of ResidueKind.options) {
      assert.doesNotThrow(() => ResidueKind.parse(k));
    }
  });

  it('ResidueKindEnum companion maps to valid values', () => {
    assert.equal(ResidueKindEnum.StaleOrdering, 'stale-ordering');
    assert.equal(ResidueKindEnum.SpeculativeDivergence, 'speculative-divergence');
    assert.equal(ResidueKindEnum.HistoricalNonCanonical, 'historical-non-canonical');
    assert.equal(ResidueKindEnum.ReorgOrphan, 'reorg-orphan');
    assert.equal(ResidueKindEnum.ShardLoss, 'shard-loss');
    // Every enum value must pass zod validation
    for (const v of Object.values(ResidueKindEnum)) {
      assert.doesNotThrow(() => ResidueKind.parse(v));
    }
  });
});

// ─── Full event validation ─────────────────────────────────────────────────
describe('EccaEvent discriminated union', () => {
  const ts = Date.now();
  const stackId = 'stack:human:1:aabbccdd';
  const sleeveId = 'sleeve:ai:2:11223344';
  const cid = 'ecca://' + 'a'.repeat(64) + '@1';

  it('validates StackCreated', () => {
    const ev = EccaEvent.parse({
      type: 'stack.created', stackId, name: 'test', kind: 'human',
      tokenId: 1, pubkey: '0x1234', ts,
    });
    assert.equal(ev.type, 'stack.created');
  });

  it('validates SleeveSpawned', () => {
    assert.doesNotThrow(() => EccaEvent.parse({
      type: 'sleeve.spawned', sleeveId, stackId, embodimentType: 'ai', ts,
    }));
  });

  it('validates PerceiveEvent', () => {
    assert.doesNotThrow(() => EccaEvent.parse({
      type: 'sleeve.perceive', sleeveId, stackId, cid, computeCost: 0.5, ts,
    }));
  });

  it('validates EpochTransition', () => {
    assert.doesNotThrow(() => EccaEvent.parse({
      type: 'epoch.transition', epoch: 42, blockHash: 'abc', crossRoot: 'def',
      evmRoot: 'e1', ipfsRoot: 'i1', sleevesRoot: 's1', difficulty: 4, ts,
    }));
  });

  it('rejects unknown event type', () => {
    assert.throws(() => EccaEvent.parse({ type: 'unknown.event', ts }));
  });
});

// ─── Constants re-exports ──────────────────────────────────────────────────
describe('ECCA constants', () => {
  it('EPOCH_INTERVAL_MS matches ECCA namespace', () => {
    assert.equal(EPOCH_INTERVAL_MS, ECCA.EPOCH_INTERVAL_MS);
    assert.equal(EPOCH_INTERVAL_MS, 4000);
  });

  it('DRIFT_MAX_DEFAULT matches ECCA namespace', () => {
    assert.equal(DRIFT_MAX_DEFAULT, ECCA.DRIFT_MAX_DEFAULT);
    assert.equal(DRIFT_MAX_DEFAULT, 15);
  });

  it('FIDELITY_MIN_DEFAULT is 0.6', () => {
    assert.equal(FIDELITY_MIN_DEFAULT, 0.6);
  });

  it('CORTEX_CHAIN_ID is 131072', () => {
    assert.equal(CORTEX_CHAIN_ID, 131072);
  });

  it('SYNAPTIC_FIELD_DEPTH is 256', () => {
    assert.equal(SYNAPTIC_FIELD_DEPTH, 256);
  });
});

// ─── NATS / Stream config ──────────────────────────────────────────────────
describe('STREAM_CONFIG', () => {
  it('stream name is ECCA', () => {
    assert.equal(STREAM_CONFIG.name, 'ECCA');
  });

  it('subjects cover all ECCA namespaces', () => {
    assert.deepEqual(STREAM_CONFIG.subjects, ['ecca.>']);
  });

  it('max messages is 1M', () => {
    assert.equal(STREAM_CONFIG.max_msgs, 1_000_000);
  });
});

describe('SUBJECTS', () => {
  it('all subjects start with ecca.', () => {
    for (const [, subj] of Object.entries(SUBJECTS)) {
      assert.ok((subj as string).startsWith('ecca.'), `Subject ${subj} must start with ecca.`);
    }
  });
});
