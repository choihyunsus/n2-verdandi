// Deterministic Louvain adapted from Daebung, with weighted contraction and a modularity gate.
import type { ClusterResult, GraphInput, WeightedGraph } from './graph-types';
import { coarsen, modularity, weightedGraph } from './weighted-graph';

const MIN_GAIN = 1e-10;
const MAX_PASSES = 30;
const MAX_LEVELS = 3;

export function clusterGraph(input: GraphInput, referenceWeight?: number): ClusterResult {
  const graph = weightedGraph(input);
  const reference = referenceWeight ?? graph.totalWeight;
  if (!Number.isFinite(reference) || reference < graph.totalWeight)
    throw new Error('Global graph weight must cover the selected graph');
  const deadline = Date.now() + 30000;
  let partition = localMoves(graph, reference, deadline);
  let quality = modularity(graph, partition, reference);
  let levels = 1;
  if (graph.paths.length > 2000) {
    for (let level = 1; level < MAX_LEVELS; level++) {
      const contracted = coarsen(graph, partition);
      if (contracted.graph.paths.length <= 1) break;
      const moved = localMoves(contracted.graph, reference, deadline);
      const candidate = partition.map((group) => moved[contracted.groups.get(group)!]!);
      const candidateQuality = modularity(graph, candidate, reference);
      if (candidateQuality <= quality + MIN_GAIN) break;
      partition = candidate;
      quality = candidateQuality;
      levels++;
    }
  }
  return { communities: groupMembers(graph, partition), modularity: quality, levels };
}

function localMoves(graph: WeightedGraph, reference: number, deadline: number): number[] {
  const partition = graph.paths.map((_, index) => index);
  if (reference === 0) return partition;
  const totals = [...graph.degrees];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let node = 0; node < graph.paths.length; node++) {
      if (Date.now() > deadline) throw new Error('Clustering time budget exceeded');
      const weights = new Map<number, number>();
      for (const [neighbor, weight] of graph.adjacency[node]!) {
        if (neighbor === node) continue;
        const group = partition[neighbor]!;
        weights.set(group, (weights.get(group) ?? 0) + weight);
      }
      const current = partition[node]!;
      totals[current]! -= graph.degrees[node]!;
      const selected = selectCommunity(current, graph.degrees[node]!, weights, totals, reference);
      totals[selected]! += graph.degrees[node]!;
      if (selected !== current) {
        partition[node] = selected;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return partition;
}

function selectCommunity(
  current: number,
  degree: number,
  weights: Map<number, number>,
  totals: number[],
  reference: number,
): number {
  const score = (group: number) =>
    (weights.get(group) ?? 0) - (degree * totals[group]!) / (2 * reference);
  const previous = score(current);
  let best = current,
    bestScore = previous;
  for (const group of [...weights.keys()].sort((a, b) => a - b)) {
    const candidate = score(group);
    if (candidate <= previous + MIN_GAIN) continue;
    if (
      candidate > bestScore + MIN_GAIN ||
      (Math.abs(candidate - bestScore) <= MIN_GAIN && group < best)
    ) {
      best = group;
      bestScore = candidate;
    }
  }
  return best;
}

function groupMembers(graph: WeightedGraph, partition: number[]): ClusterResult['communities'] {
  const groups = new Map<number, string[]>();
  for (let node = 0; node < graph.paths.length; node++) {
    const group = partition[node]!;
    const members = groups.get(group) ?? [];
    members.push(graph.paths[node]!);
    groups.set(group, members);
  }
  return [...groups.values()].map((members) => ({ id: members[0]!, members }));
}
