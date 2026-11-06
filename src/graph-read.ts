// Community summaries and details always describe one published, owner-scoped snapshot.
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import { boundedRows } from './graph-budget';
import { readStatus } from './status';

export interface CommunitySummary {
  id: string;
  size: number;
  internalEdges: number;
  builtAt: number;
}
export interface CommunityDetail extends CommunitySummary {
  members: Array<{ path: string; degree: number }>;
  bridges: Array<{ target: string; weight: number }>;
  stale: boolean;
}

export function listCommunities(store: GraphStore, limit = 100, offset = 0) {
  if (integer(limit, 'community limit', 20000) === 0)
    throw new Error('Community limit must be positive');
  integer(offset, 'community offset', 20000);
  return store.connection.transaction(() => {
    const status = readStatus(store);
    const rows = boundedRows<Record<string, unknown>>(
      store.connection,
      'SELECT id,size,internal_edges,built_at FROM verdandi_communities WHERE project=? AND agent=? ORDER BY size DESC,id LIMIT ? OFFSET ?',
      [store.project, store.agent, limit, offset],
      limit,
      ['id'],
    );
    return {
      total: status.communityCount,
      limit,
      offset,
      stale: status.stale,
      items: rows.map(communityRow),
    };
  });
}

export function readCommunity(store: GraphStore, id: string): CommunityDetail | null {
  const key = relativePath(id);
  return store.connection.transaction(() => {
    const record = store.connection.query<Record<string, unknown>>(
      'SELECT id,size,internal_edges,built_at FROM verdandi_communities WHERE project=? AND agent=? AND id=?',
      [store.project, store.agent, key],
    )[0];
    if (!record) return null;
    const summary = communityRow(record);
    const members = boundedRows<Record<string, unknown>>(
      store.connection,
      'SELECT path,degree FROM verdandi_members WHERE project=? AND agent=? AND community_id=? ORDER BY degree DESC,path LIMIT 20001',
      [store.project, store.agent, key],
      20000,
      ['path'],
    ).map((row) => ({
      path: relativePath(text(row.path, 'member path')),
      degree: integer(row.degree, 'member degree', 19999),
    }));
    if (members.length !== summary.size)
      throw new Error('Published community size does not match its members');
    const bridges = boundedRows<Record<string, unknown>>(
      store.connection,
      `SELECT CASE WHEN src_community=? THEN dst_community ELSE src_community END AS target,weight
      FROM verdandi_bridges WHERE project=? AND agent=? AND (src_community=? OR dst_community=?)
      ORDER BY weight DESC,target LIMIT 20001`,
      [key, store.project, store.agent, key, key],
      20000,
      ['target'],
    ).map((row) => ({
      target: relativePath(text(row.target, 'bridge target')),
      weight: integer(row.weight, 'bridge weight', 100000),
    }));
    return { ...summary, members, bridges, stale: readStatus(store).stale };
  });
}

function communityRow(row: Record<string, unknown>): CommunitySummary {
  const size = integer(row.size, 'community size', 20000);
  if (!size) throw new Error('Published communities must have members');
  return {
    id: relativePath(text(row.id, 'community ID')),
    size,
    internalEdges: integer(row.internal_edges, 'community edge count', 100000),
    builtAt: integer(row.built_at, 'community timestamp'),
  };
}
