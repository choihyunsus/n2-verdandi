// Preserve crossing multiplicities and internal self-loop mass at every Louvain level.
import type { GraphInput, WeightedGraph } from './graph-types';
import { validateGraphBudget } from './graph-budget';

export function weightedGraph(input: GraphInput): WeightedGraph {
  validateGraphBudget(input);
  const paths = input.nodes.map((node) => node.path).sort();
  if (paths.some((path) => typeof path !== 'string' || !path || path.length > 4096))
    throw new Error('Invalid graph path');
  const indices = new Map(paths.map((path, index) => [path, index]));
  if (indices.size !== paths.length) throw new Error('Duplicate graph path');
  const adjacency = paths.map(() => new Map<number, number>());
  for (const edge of input.edges) {
    const source = indices.get(edge.source),
      target = indices.get(edge.target);
    if (source === undefined || target === undefined) throw new Error('Dangling graph edge');
    if (source === target) continue;
    adjacency[source]!.set(target, 1);
    adjacency[target]!.set(source, 1);
  }
  return fromAdjacency(paths, adjacency);
}

export function fromAdjacency(
  paths: string[],
  adjacency: Array<Map<number, number>>,
): WeightedGraph {
  const degrees = adjacency.map((neighbors) =>
    [...neighbors.values()].reduce((sum, weight) => sum + weight, 0),
  );
  return {
    paths,
    adjacency,
    degrees,
    totalWeight: degrees.reduce((sum, degree) => sum + degree, 0) / 2,
  };
}

export function coarsen(
  graph: WeightedGraph,
  partition: number[],
): {
  graph: WeightedGraph;
  groups: Map<number, number>;
} {
  const groups = new Map<number, number>();
  const paths: string[] = [];
  for (let node = 0; node < partition.length; node++) {
    const group = partition[node]!;
    if (!groups.has(group)) {
      groups.set(group, groups.size);
      paths.push(graph.paths[node]!);
    }
  }
  const adjacency = paths.map(() => new Map<number, number>());
  for (let node = 0; node < graph.paths.length; node++) {
    const source = groups.get(partition[node]!)!;
    for (const [neighbor, weight] of graph.adjacency[node]!) {
      const target = groups.get(partition[neighbor]!)!;
      const neighbors = adjacency[source]!;
      neighbors.set(target, (neighbors.get(target) ?? 0) + weight);
    }
  }
  return { graph: fromAdjacency(paths, adjacency), groups };
}

export function modularity(
  graph: WeightedGraph,
  partition: number[],
  referenceWeight = graph.totalWeight,
): number {
  if (referenceWeight === 0) return 0;
  const communities = new Map<number, { degree: number; internal: number }>();
  for (let node = 0; node < graph.paths.length; node++) {
    const group = partition[node]!;
    const state = communities.get(group) ?? { degree: 0, internal: 0 };
    state.degree += graph.degrees[node]!;
    for (const [neighbor, weight] of graph.adjacency[node]!) {
      if (partition[neighbor] === group) state.internal += weight / 2;
    }
    communities.set(group, state);
  }
  return [...communities.values()].reduce(
    (sum, state) =>
      sum + state.internal / referenceWeight - (state.degree / (2 * referenceWeight)) ** 2,
    0,
  );
}
