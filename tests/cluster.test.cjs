const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clusterGraph } = require('../dist/cluster');
const { weightedGraph, coarsen, modularity } = require('../dist/weighted-graph');

function graph(paths, edges) {
  return {
    nodes: paths.map((path) => ({ path, language: 'ts' })),
    edges: edges.map(([source, target]) => ({ source, target })),
  };
}

test('weighted contraction retains internal mass and the original modularity', () => {
  const input = graph(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['c', 'd'],
    ],
  );
  const weighted = weightedGraph(input),
    partition = [0, 0, 0, 3];
  const contracted = coarsen(weighted, partition).graph;
  assert.equal(contracted.totalWeight, 4);
  assert.equal(contracted.adjacency[0].get(0), 6);
  assert.equal(contracted.adjacency[0].get(1), 1);
  assert.equal(modularity(contracted, [0, 1]), modularity(weighted, partition));
});

test('large graph clustering keeps strong communities that legacy coarsening incorrectly merged', () => {
  const paths = Array.from({ length: 2010 }, (_, index) => 'node' + String(index).padStart(4, '0'));
  const edges = [];
  for (let group = 0; group < 10; group++) {
    for (let a = 0; a < 10; a++)
      for (let b = a + 1; b < 10; b++) edges.push([paths[group * 10 + a], paths[group * 10 + b]]);
    if (group < 9) edges.push([paths[group * 10], paths[(group + 1) * 10]]);
  }
  const result = clusterGraph(graph(paths, edges));
  assert.ok(result.modularity >= 0.880389, JSON.stringify(result));
  assert.equal(result.communities.filter((group) => group.members.length === 10).length, 10);
  assert.equal(
    result.communities.reduce((count, group) => count + group.members.length, 0),
    2010,
  );
});

test('empty, isolated, duplicate and permuted inputs retain deterministic behavior', () => {
  assert.deepEqual(clusterGraph(graph([], [])).communities, []);
  assert.deepEqual(clusterGraph(graph(['a'], [])).communities, [{ id: 'a', members: ['a'] }]);
  const input = graph(
    ['c', 'b', 'a'],
    [
      ['b', 'c'],
      ['a', 'b'],
      ['a', 'c'],
    ],
  );
  assert.deepEqual(
    clusterGraph(input),
    clusterGraph({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }),
  );
  assert.deepEqual(
    clusterGraph(input),
    clusterGraph({ ...input, edges: [...input.edges, ...input.edges] }),
  );
  assert.throws(() => clusterGraph(graph(['a', 'a'], [])), /Duplicate/);
  assert.throws(() => clusterGraph(graph(['a'], [['a', 'missing']])), /Dangling/);
  assert.throws(() => clusterGraph(input, 0), /Global graph weight/);
});
