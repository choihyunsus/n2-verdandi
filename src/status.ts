// Read graph, semantic and index freshness from one owner-scoped database snapshot.
import { integer, optionalText, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import { readBuildState } from './build-state';
import { graphCounts } from './graph-publish';
import { inputRevision } from './graph-input';
import { semanticRevision } from './semantic-vectors';

export function readStatus(store: GraphStore) {
  return store.connection.transaction(() => {
    const published = readBuildState(store);
    const indexed = indexExists(store);
    const currentRevision = indexed ? inputRevision(store) : null;
    const semantic = store.connection.query<Record<string, unknown>>(
      'SELECT model,input_revision,built_at FROM verdandi_semantic_build WHERE project=? AND agent=?',
      [store.project, store.agent],
    )[0];
    const semanticInput = indexed ? semanticRevision(store) : null;
    const semanticPublished = semantic
      ? {
          model: optionalText(semantic.model, 'semantic model'),
          inputRevision: text(semantic.input_revision, 'semantic publication revision'),
          builtAt: integer(semantic.built_at, 'semantic timestamp'),
        }
      : null;
    return {
      ...graphCounts(store),
      published: published ?? null,
      indexed,
      currentRevision,
      coverage: indexed ? indexCoverage(store) : ('unknown' as const),
      stale: published === undefined || currentRevision !== published.inputRevision,
      semantic: {
        edgeCount: count(store, 'verdandi_semantic_edges'),
        published: semanticPublished,
        currentRevision: semanticInput,
        stale: !semanticPublished || semanticPublished.inputRevision !== semanticInput,
      },
      documents: count(store, 'verdandi_docs'),
      dirtyFiles: count(store, 'verdandi_dirty'),
      leases: jobLeases(store),
    };
  });
}

export type VerdandiStatus = ReturnType<typeof readStatus>;

function indexExists(store: GraphStore): boolean {
  const version = store.connection.query<{ value: unknown }>(
    "SELECT value FROM meta WHERE key='arachne_schema_version'",
  )[0];
  if (!version) return false;
  if (version.value !== '1') throw new Error('Unsupported Arachne source schema');
  return (
    store.connection.query('SELECT 1 FROM arachne_scope_state WHERE project=? AND agent=?', [
      store.project,
      store.agent,
    ]).length > 0
  );
}

export function indexCoverage(store: GraphStore): 'complete' | 'partial' | 'unknown' {
  const row = store.connection.query<{ value: unknown }>(
    "SELECT value FROM arachne_metadata WHERE project=? AND agent=? AND key='last_scan_complete'",
    [store.project, store.agent],
  )[0];
  if (!row) return 'unknown';
  if (row.value !== 'true' && row.value !== 'false')
    throw new Error('Invalid stored index coverage');
  return row.value === 'true' ? 'complete' : 'partial';
}

function count(store: GraphStore, table: string): number {
  return integer(
    store.connection.query<{ count: unknown }>(
      `SELECT count(*) AS count FROM ${table} WHERE project=? AND agent=?`,
      [store.project, store.agent],
    )[0]?.count,
    `${table} count`,
  );
}

function jobLeases(store: GraphStore) {
  return store.connection
    .query<
      Record<string, unknown>
    >('SELECT kind,process_id,started_at,expires_at FROM verdandi_jobs WHERE project=? AND agent=? LIMIT 3', [store.project, store.agent])
    .map((row) => {
      if (row.kind !== 'graph' && row.kind !== 'semantic')
        throw new Error('Invalid stored job kind');
      return {
        kind: row.kind,
        processId: integer(row.process_id, 'job process'),
        startedAt: integer(row.started_at, 'job start'),
        expiresAt: integer(row.expires_at, 'job expiry'),
        expired: integer(row.expires_at, 'job expiry') <= Date.now(),
      };
    });
}
