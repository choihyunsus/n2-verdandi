// Import backlinks, fresh semantic neighbors and community peers share one scoped snapshot.
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import { readImports, readSemanticLinks } from './graph-links';
import { assertArachneSchema, inputRevision } from './graph-input';
import { boundedRows } from './graph-budget';
import { readBuildState } from './build-state';
import { semanticRevision } from './semantic-vectors';

export interface BacklinkOptions {
  limit?: number;
  includeSemantic?: boolean;
}

export function readBacklinks(store: GraphStore, filename: string, options: BacklinkOptions = {}) {
  if (options.includeSemantic !== undefined && typeof options.includeSemantic !== 'boolean')
    throw new Error('includeSemantic must be a boolean');
  const key = relativePath(filename),
    limit = integer(options.limit ?? 20, 'backlink limit', 1000);
  if (!limit) throw new Error('Backlink limit must be positive');
  return store.connection.transaction(() => {
    assertArachneSchema(store);
    const exists =
      store.connection.query('SELECT 1 FROM arachne_files WHERE project=? AND agent=? AND path=?', [
        store.project,
        store.agent,
        key,
      ]).length > 0;
    if (!exists) return null;
    const imports = readImports(store, { nodePath: key })
      .filter((edge) => edge.target === key)
      .map((edge) => ({ path: edge.source, type: edge.dependencyType! }));
    const semantic = options.includeSemantic === false ? [] : freshNeighbors(store, key);
    const peers = readPeers(store, key);
    return {
      path: key,
      ...freshnessState(store, options.includeSemantic !== false),
      totals: { imports: imports.length, semantic: semantic.length, peers: peers.length },
      limit,
      importBacklinks: imports.slice(0, limit),
      semanticNeighbors: semantic.slice(0, limit),
      communityPeers: peers.slice(0, limit),
    };
  });
}

function freshNeighbors(store: GraphStore, key: string) {
  const now = Date.now() / 1000;
  return readSemanticLinks(store, { nodePath: key })
    .map((edge) => {
      const freshness = 1 / (1 + (0.005 * Math.max(0, now - edge.computedAt!)) / 86400);
      return {
        path: edge.source === key ? edge.target : edge.source,
        similarity: edge.similarity!,
        freshness,
        hybridScore: edge.similarity! * freshness,
        model: edge.model!,
        computedAt: edge.computedAt!,
      };
    })
    .sort(
      (a, b) => b.hybridScore - a.hybridScore || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
}

function freshnessState(store: GraphStore, includeSemantic: boolean) {
  const published = readBuildState(store);
  let semanticStale: boolean | null = null;
  if (includeSemantic) {
    const semantic = store.connection.query<{ input_revision: unknown }>(
      'SELECT input_revision FROM verdandi_semantic_build WHERE project=? AND agent=?',
      [store.project, store.agent],
    )[0];
    semanticStale =
      !semantic || text(semantic.input_revision, 'semantic revision') !== semanticRevision(store);
  }
  return { stale: !published || published.inputRevision !== inputRevision(store), semanticStale };
}

function readPeers(store: GraphStore, path: string) {
  return boundedRows<Record<string, unknown>>(
    store.connection,
    `SELECT other.path,other.degree,other.community_id FROM verdandi_members own
    JOIN verdandi_members other ON own.project=other.project AND own.agent=other.agent AND own.community_id=other.community_id
    WHERE own.project=? AND own.agent=? AND own.path=? AND other.path!=? ORDER BY other.degree DESC,other.path LIMIT 20001`,
    [store.project, store.agent, path, path],
    20000,
    ['path', 'community_id'],
  ).map((row) => ({
    path: relativePath(text(row.path, 'peer path')),
    degree: integer(row.degree, 'peer degree', 19999),
    community: relativePath(text(row.community_id, 'peer community')),
  }));
}
