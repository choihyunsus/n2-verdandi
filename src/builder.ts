// Compute outside database transactions, then fence publication against current inputs.
import type { GraphStore } from './store';
import type { BuildPlan, BuildResult } from './build-types';
import type { ClusterResult } from './graph-types';
import { acquireLease, releaseLease } from './job-lease';
import { readBuildPlan } from './build-plan';
import { computeClusters } from './compute';
import { preparePayload } from './graph-payload';
import { publishGraph } from './graph-publish';
import { modularity, weightedGraph } from './weighted-graph';

export interface BuildOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export async function buildGraph(
  store: GraphStore,
  options: BuildOptions = {},
): Promise<BuildResult> {
  if (options.force !== undefined && typeof options.force !== 'boolean')
    throw new Error('force must be a boolean');
  options.signal?.throwIfAborted();
  const lease = acquireLease(store, 'graph');
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      options.signal?.throwIfAborted();
      const plan = readBuildPlan(store, options.force ?? false);
      const result =
        plan.strategy === 'no_changes'
          ? undefined
          : await computeClusters(plan.selected, plan.snapshot.graph.edges.length, options.signal);
      options.signal?.throwIfAborted();
      const payload = result ? preparePayload(plan.selected, result) : undefined;
      const published = publishGraph(
        store,
        lease,
        plan,
        payload,
        quality(plan, result),
        options.signal,
      );
      if (published) return { ...published, attempts: attempt };
    }
    throw new Error(
      'Graph inputs changed during three build attempts; retry after indexing finishes',
    );
  } finally {
    releaseLease(store, lease);
  }
}

function quality(plan: BuildPlan, result: ClusterResult | undefined): number {
  if (!result) return plan.previous!.modularity;
  if (plan.strategy === 'full') return result.modularity;
  const affected = new Set(plan.affected);
  const owners = new Map(
    plan.previousMembers
      .filter((member) => !affected.has(member.communityId))
      .map((member) => [member.path, member.communityId]),
  );
  for (const community of result.communities)
    for (const path of community.members) owners.set(path, community.id);
  const graph = weightedGraph(plan.snapshot.graph);
  const groups = new Map<string, number>();
  const partition = graph.paths.map((path) => {
    const owner = owners.get(path);
    if (owner === undefined) throw new Error('Incremental membership is incomplete');
    if (!groups.has(owner)) groups.set(owner, groups.size);
    return groups.get(owner)!;
  });
  return modularity(graph, partition);
}
