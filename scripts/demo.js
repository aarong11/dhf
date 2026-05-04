// scripts/demo.js — End-to-end ECCA simulation.
// Spawns a stack, two sleeves, writes memory, mines an epoch, needlecasts.

const { DHFStack, registerStack } = require('../dhs-core');
const { spawnSleeve } = require('../sleeves');
const { needlecast } = require('../needlecasting');
const { network } = require('../mining-network');
const { engine } = require('../coordination-engine');

function line(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

const stack = registerStack(new DHFStack({ name: 'Kovacs', kind: 'human' }));
line('STACK MINTED');
console.log(stack.state());

const sleeveA = spawnSleeve({ stackId: stack.id, embodiment_type: 'human' });
const sleeveB = spawnSleeve({ stackId: stack.id, embodiment_type: 'ai' });
line('TWO SLEEVES SPAWNED (same identity, different substrates)');
console.log({ A: sleeveA.state(), B: sleeveB.state() });

sleeveA.perceive('I remember the smell of rain on Harlan\'s World.');
sleeveA.perceive('A name: Quellcrist Falconer.');
sleeveA.perceive('Coordinates of the safehouse: 38.7N, 145.2E.');
line('SLEEVE A PERCEIVED 3 MEMORIES');
console.log(sleeveA.recall(8));

line('MINE BLOCK (epoch advance)');
console.log(network.mineBlock('genesis-pool'));

line('NEEDLECAST A → B (re-sleeving)');
const result = needlecast(sleeveA.id, sleeveB.id);
console.log(result);

line('SLEEVE B AFTER RECONSTRUCTION');
console.log(sleeveB.state());
console.log('B can recall A\'s memories:');
console.log(sleeveB.recall(8));

line('CONTINUITY CHECK');
console.log(engine.continuity(stack.id));

line('CROSS-CHAIN COHERENCE TICK');
console.log(engine.tick());

line('DONE');
