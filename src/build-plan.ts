// Incremental work includes entire old communities and current connected components.
import type { GraphStore } from './store';
import type { BuildPlan, StoredMember } from './build-types';
import type { GraphSnapshot } from './graph-input';
import { readGraphSnapshot } from './graph-input';
import { readBuildState, readDirtyPaths, readMembers, readNodeHashes } from './build-state';

export function readBuildPlan(store: GraphStore, force: boolean): BuildPlan {
  return store.connection.transaction(() => {
    const snapshot = readGraphSnapshot(store);
    const previous = readBuildState(store);
    const previousMembers = readMembers(store);
    const plan: BuildPlan = {
      snapshot,
      previous,
      previousMembers,
      selected: snapshot.graph,
      strategy: 'full',
      affected: [],
    };
    if (force || !previous) return plan;
    const previousPaths = new Set(previousMembers.map((member) => member.path));
    if (
      previous.topologyHash === snapshot.topologyHash &&
      previousMembers.length === snapshot.graph.nodes.length &&
      snapshot.graph.nodes.every((node) => previousPaths.has(node.path))
    )
      return { ...plan, strategy: 'no_changes' };
    if (
      snapshot.graph.nodes.length > 2000 ||
      !previousMembers.length ||
      previousMembers.length > 2000 ||
      previous.edgeCount !== snapshot.graph.edges.length
    )
      return plan;
    const changed = changedPaths(store, snapshot, previousMembers);
    const limit = Math.max(1, snapshot.graph.nodes.length) * 0.3;
    if (!changed.size || changed.size > limit) return plan;
    const expanded = expandComponents(snapshot, previousMembers, changed);
    const nodes = snapshot.graph.nodes.filter((node) => expanded.paths.has(node.path));
    if (nodes.length > limit) return plan;
    return {
      ...plan,
      strategy: 'incremental',
      affected: [...expanded.communities],
      selected: {
        nodes,
        edges: snapshot.graph.edges.filter((edge) => expanded.paths.has(edge.source)),
      },
    };
  });
}

function changedPaths(
  store: GraphStore,
  snapshot: GraphSnapshot,
  members: StoredMember[],
): Set<string> {
  const changed = readDirtyPaths(store);
  const old = readNodeHashes(store);
  for (const node of snapshot.nodeHashes) {
    if (old.get(node.path) !== node.hash) changed.add(node.path);
    old.delete(node.path);
  }
  for (const path of old.keys()) changed.add(path);
  const live = new Set(snapshot.graph.nodes.map((node) => node.path));
  const previous = new Set(members.map((member) => member.path));
  for (const path of live) if (!previous.has(path)) changed.add(path);
  for (const path of previous) if (!live.has(path)) changed.add(path);
  return changed;
}

function expandComponents(
  snapshot: GraphSnapshot,
  members: StoredMember[],
  changed: Set<string>,
): {
  paths: Set<string>;
  communities: Set<string>;
} {
  const owners = new Map(members.map((member) => [member.path, member.communityId]));
  const groups = new Map<string, string[]>();
  for (const member of members) {
    const group = groups.get(member.communityId) ?? [];
    group.push(member.path);
    groups.set(member.communityId, group);
  }
  const neighbors = new Map(snapshot.graph.nodes.map((node) => [node.path, [] as string[]]));
  for (const edge of snapshot.graph.edges) {
    neighbors.get(edge.source)!.push(edge.target);
    neighbors.get(edge.target)!.push(edge.source);
  }
  const paths = new Set(changed),
    communities = new Set<string>(),
    queue = [...changed];
  const append = (path: string): void => {
    if (!paths.has(path)) {
      paths.add(path);
      queue.push(path);
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!,
      owner = owners.get(path);
    if (owner !== undefined && !communities.has(owner)) {
      communities.add(owner);
      for (const member of groups.get(owner)!) append(member);
    }
    for (const neighbor of neighbors.get(path) ?? []) append(neighbor);
  }
  return { paths, communities };
}
