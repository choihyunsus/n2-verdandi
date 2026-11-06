// Validate worker partitions and compute each undirected edge exactly once.
import type { GraphInput, ClusterResult } from './graph-types';

export interface GraphPayload {
  communities: Array<{ id: string; size: number; internalEdges: number }>;
  members: Array<{ path: string; communityId: string; degree: number }>;
  bridges: Array<{ source: string; target: string; weight: number }>;
}

export function preparePayload(graph: GraphInput, result: ClusterResult): GraphPayload {
  const live = new Set(graph.nodes.map((node) => node.path));
  const owners = new Map<string, string>();
  const communities = new Map<string, GraphPayload['communities'][number]>();
  for (const group of result.communities) {
    if (
      !group.members.length ||
      group.id !== [...group.members].sort()[0] ||
      communities.has(group.id)
    )
      throw new Error('Invalid computed community');
    communities.set(group.id, { id: group.id, size: group.members.length, internalEdges: 0 });
    for (const path of group.members) {
      if (!live.has(path) || owners.has(path)) throw new Error('Invalid computed membership');
      owners.set(path, group.id);
    }
  }
  if (owners.size !== live.size) throw new Error('Computed membership is incomplete');
  const degrees = new Map(graph.nodes.map((node) => [node.path, 0]));
  const bridges = new Map<string, GraphPayload['bridges'][number]>();
  for (const edge of graph.edges) {
    degrees.set(edge.source, degrees.get(edge.source)! + 1);
    degrees.set(edge.target, degrees.get(edge.target)! + 1);
    const first = owners.get(edge.source)!,
      second = owners.get(edge.target)!;
    if (first === second) communities.get(first)!.internalEdges++;
    else {
      const [source, target] = [first, second].sort() as [string, string];
      const key = JSON.stringify([source, target]);
      const bridge = bridges.get(key) ?? { source, target, weight: 0 };
      bridge.weight++;
      bridges.set(key, bridge);
    }
  }
  return {
    communities: [...communities.values()],
    bridges: [...bridges.values()],
    members: graph.nodes.map((node) => ({
      path: node.path,
      communityId: owners.get(node.path)!,
      degree: degrees.get(node.path)!,
    })),
  };
}
