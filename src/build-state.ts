// Read published state with ownership filters and validation before planning an update.
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { BuildState, StoredMember } from './build-types';
import { boundedRows } from './graph-budget';

export function readBuildState(store: GraphStore): BuildState | undefined {
  const row = store.connection.query<Record<string, unknown>>(
    'SELECT * FROM verdandi_build_state WHERE project=? AND agent=?',
    [store.project, store.agent],
  )[0];
  if (!row) return undefined;
  if (typeof row.modularity !== 'number' || !Number.isFinite(row.modularity))
    throw new Error('Invalid stored modularity');
  return {
    topologyHash: digest(row.topology_hash),
    inputRevision: text(row.input_revision, 'published input revision'),
    edgeCount: integer(row.edge_count, 'published edge count', 100000),
    modularity: row.modularity,
    builtAt: integer(row.built_at, 'graph timestamp'),
  };
}

export function readMembers(store: GraphStore): StoredMember[] {
  return boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT path,community_id,degree FROM verdandi_members WHERE project=? AND agent=? ORDER BY path LIMIT 20001',
    [store.project, store.agent],
    20000,
    ['path', 'community_id'],
  ).map((row) => ({
    path: relativePath(text(row.path, 'member path')),
    communityId: relativePath(text(row.community_id, 'community ID')),
    degree: integer(row.degree, 'member degree', 19999),
  }));
}

export function readNodeHashes(store: GraphStore): Map<string, string> {
  const rows = boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT path,topology_hash FROM verdandi_node_state WHERE project=? AND agent=? LIMIT 20001',
    [store.project, store.agent],
    20000,
    ['path', 'topology_hash'],
  );
  return new Map(
    rows.map((row) => [relativePath(text(row.path, 'node path')), digest(row.topology_hash)]),
  );
}

export function readDirtyPaths(store: GraphStore): Set<string> {
  return new Set(
    boundedRows<{ path: unknown }>(
      store.connection,
      'SELECT path FROM verdandi_dirty WHERE project=? AND agent=? ORDER BY path LIMIT 40001',
      [store.project, store.agent],
      40000,
      ['path'],
    ).map((row) => relativePath(text(row.path, 'dirty path'))),
  );
}

function digest(value: unknown): string {
  const hash = text(value, 'topology hash');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid stored topology hash');
  return hash;
}
