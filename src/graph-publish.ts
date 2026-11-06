// Publish graph rows, fingerprints and dirty acknowledgements in one transaction.
import type { GraphStore } from './store';
import type { BuildPlan, BuildResult } from './build-types';
import type { GraphPayload } from './graph-payload';
import type { JobLease } from './job-lease';
import { assertLease } from './job-lease';
import { inputRevision, readGraphSnapshot } from './graph-input';
import { integer } from 'n2-arachne/dist/lib/store-values.js';

export function publishGraph(
  store: GraphStore,
  lease: JobLease,
  plan: BuildPlan,
  payload: GraphPayload | undefined,
  quality: number,
  signal?: AbortSignal,
): BuildResult | undefined {
  return store.connection.transaction(() => {
    signal?.throwIfAborted();
    assertLease(store, lease);
    if (
      inputRevision(store) !== plan.snapshot.revision ||
      readGraphSnapshot(store).topologyHash !== plan.snapshot.topologyHash
    )
      return undefined;
    if (!Number.isFinite(quality)) throw new Error('Invalid computed modularity');
    const now = Math.floor(Date.now() / 1000);
    if (payload) replaceRows(store, plan, payload, now);
    publishState(store, plan, quality, now);
    if (payload)
      store.connection.execute(
        'UPDATE verdandi_scope_state SET graph_revision=graph_revision+1 WHERE project=? AND agent=?',
        [store.project, store.agent],
      );
    return {
      ...graphCounts(store),
      nodeCount: plan.snapshot.graph.nodes.length,
      edgeCount: plan.snapshot.graph.edges.length,
      modularity: quality,
      strategy: plan.strategy,
      coverage: plan.snapshot.coverage,
      inputRevision: plan.snapshot.revision,
      topologyHash: plan.snapshot.topologyHash,
      attempts: 1,
    };
  });
}

function publishState(store: GraphStore, plan: BuildPlan, quality: number, now: number): void {
  const scope = [store.project, store.agent];
  store.connection.execute(
    `INSERT INTO verdandi_build_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(project,agent)
    DO UPDATE SET topology_hash=excluded.topology_hash,input_revision=excluded.input_revision,
    edge_count=excluded.edge_count,modularity=excluded.modularity,built_at=excluded.built_at`,
    [
      ...scope,
      plan.snapshot.topologyHash,
      plan.snapshot.revision,
      plan.snapshot.graph.edges.length,
      quality,
      now,
    ],
  );
  store.connection.execute('DELETE FROM verdandi_node_state WHERE project=? AND agent=?', scope);
  for (const node of plan.snapshot.nodeHashes)
    store.connection.execute('INSERT INTO verdandi_node_state VALUES(?,?,?,?)', [
      ...scope,
      node.path,
      node.hash,
    ]);
  store.connection.execute('DELETE FROM verdandi_dirty WHERE project=? AND agent=?', scope);
}

function replaceRows(store: GraphStore, plan: BuildPlan, payload: GraphPayload, now: number): void {
  const scope = [store.project, store.agent];
  if (plan.strategy === 'full') {
    for (const table of ['verdandi_bridges', 'verdandi_members', 'verdandi_communities'])
      store.connection.execute(`DELETE FROM ${table} WHERE project=? AND agent=?`, scope);
  } else {
    for (const id of plan.affected) {
      store.connection.execute(
        'DELETE FROM verdandi_bridges WHERE project=? AND agent=? AND (src_community=? OR dst_community=?)',
        [...scope, id, id],
      );
      store.connection.execute(
        'DELETE FROM verdandi_members WHERE project=? AND agent=? AND community_id=?',
        [...scope, id],
      );
      store.connection.execute(
        'DELETE FROM verdandi_communities WHERE project=? AND agent=? AND id=?',
        [...scope, id],
      );
    }
  }
  for (const row of payload.communities)
    store.connection.execute('INSERT INTO verdandi_communities VALUES(?,?,?,?,?,?)', [
      ...scope,
      row.id,
      row.size,
      row.internalEdges,
      now,
    ]);
  for (const row of payload.members)
    store.connection.execute('INSERT INTO verdandi_members VALUES(?,?,?,?,?)', [
      ...scope,
      row.path,
      row.communityId,
      row.degree,
    ]);
  for (const row of payload.bridges)
    store.connection.execute('INSERT INTO verdandi_bridges VALUES(?,?,?,?,?)', [
      ...scope,
      row.source,
      row.target,
      row.weight,
    ]);
}

export function graphCounts(
  store: GraphStore,
): Pick<BuildResult, 'communityCount' | 'memberCount' | 'bridgeCount'> {
  const count = (table: string): number =>
    integer(
      store.connection.query<{ n: unknown }>(
        `SELECT count(*) AS n FROM ${table} WHERE project=? AND agent=?`,
        [store.project, store.agent],
      )[0]?.n,
      'stored graph count',
    );
  return {
    communityCount: count('verdandi_communities'),
    memberCount: count('verdandi_members'),
    bridgeCount: count('verdandi_bridges'),
  };
}
