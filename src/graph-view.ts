// Graph views retain published communities while exposing current input freshness explicitly.
import { integer, optionalText, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { GraphView, ViewEdge, ViewNode } from './graph-view-types';
import { boundedRows, MAX_GRAPH_TEXT_BYTES } from './graph-budget';
import { listCommunities, readCommunity } from './graph-read';
import { readLinks } from './graph-links';
import { assertArachneSchema } from './graph-input';
import { readStatus } from './status';

export function readGraphView(store: GraphStore, level: 0 | 1 | 2, id?: string): GraphView | null {
  if (![0, 1, 2].includes(level)) throw new Error('Graph level must be 0, 1 or 2');
  const key = level === 0 ? undefined : relativePath(id!);
  return store.connection.transaction(() => {
    const status = readStatus(store);
    const content =
      level === 0 ? overview(store) : level === 1 ? community(store, key!) : node(store, key!);
    if (!content) return null;
    if (content.nodes.length > 20000 || content.edges.length > 100000)
      throw new Error('Graph view exceeds 20,000 nodes or 100,000 edges');
    const nodes = new Set(content.nodes.map((node) => node.id));
    if (content.edges.some((edge) => !nodes.has(edge.source) || !nodes.has(edge.target)))
      throw new Error('Graph view contains dangling links');
    return {
      level,
      ...content,
      stale: status.stale,
      semanticStale: status.semantic.edgeCount > 0 && status.semantic.stale,
      coverage: status.coverage,
    };
  });
}

function overview(store: GraphStore): Pick<GraphView, 'nodes' | 'edges'> {
  const groups = listCommunities(store, 20000).items;
  const languageCounts = groups.length ? dominantLanguages(store) : new Map<string, string>();
  const nodes: ViewNode[] = groups.map((group) => ({
    id: group.id,
    size: group.size,
    internal_edges: group.internalEdges,
    type: 'community',
    language: languageCounts.get(group.id) ?? 'unknown',
  }));
  const edges = boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT src_community,dst_community,weight FROM verdandi_bridges WHERE project=? AND agent=? ORDER BY src_community,dst_community LIMIT 100001',
    [store.project, store.agent],
    100000,
    ['src_community', 'dst_community'],
  ).map(
    (row): ViewEdge => ({
      source: relativePath(text(row.src_community, 'bridge source')),
      target: relativePath(text(row.dst_community, 'bridge target')),
      weight: integer(row.weight, 'bridge weight', 100000),
      type: 'bridge',
    }),
  );
  return { nodes, edges };
}

function community(
  store: GraphStore,
  id: string,
): Pick<GraphView, 'nodes' | 'edges' | 'community_id'> | null {
  const detail = readCommunity(store, id);
  if (!detail) return null;
  assertArachneSchema(store);
  const languages = fileLanguages(
    store,
    detail.members.map((member) => member.path),
  );
  return {
    community_id: id,
    nodes: detail.members.map((member) => ({
      id: member.path,
      degree: member.degree,
      language: languages.get(member.path) ?? 'unknown',
      type: 'file',
    })),
    edges: readLinks(store, { communityId: id }),
  };
}

function node(
  store: GraphStore,
  filename: string,
): Pick<GraphView, 'nodes' | 'edges' | 'center'> | null {
  assertArachneSchema(store);
  const exists = fileLanguages(store, [filename]);
  if (!exists.has(filename)) return null;
  const edges = readLinks(store, { nodePath: filename });
  const paths = new Set([filename]);
  for (const edge of edges) {
    paths.add(edge.source);
    paths.add(edge.target);
  }
  if (paths.size > 20000) throw new Error('Node view exceeds 20,000 neighbors');
  const languages = fileLanguages(store, [...paths]);
  return {
    center: filename,
    nodes: [...paths].sort().map((path) => ({
      id: path,
      language: languages.get(path) ?? 'unknown',
      type: path === filename ? 'center' : 'neighbor',
    })),
    edges,
  };
}

function fileLanguages(store: GraphStore, paths: string[]): Map<string, string> {
  const languages = new Map<string, string>();
  const budget = { remaining: MAX_GRAPH_TEXT_BYTES };
  for (let start = 0; start < paths.length; start += 200) {
    const batch = paths.slice(start, start + 200);
    const rows = boundedRows<{ path: unknown; language: unknown }>(
      store.connection,
      `SELECT path,language FROM arachne_files WHERE project=? AND agent=? AND path IN (${batch.map(() => '?').join(',')})`,
      [store.project, store.agent, ...batch],
      batch.length,
      ['path', 'language'],
      budget,
    );
    for (const row of rows)
      languages.set(
        relativePath(text(row.path, 'file path')),
        optionalText(row.language, 'file language') ?? 'unknown',
      );
  }
  return languages;
}

function dominantLanguages(store: GraphStore): Map<string, string> {
  assertArachneSchema(store);
  const rows = boundedRows<{ community_id: unknown; language: unknown }>(
    store.connection,
    `SELECT vm.community_id,f.language,count(*) AS n FROM verdandi_members vm
    JOIN arachne_files f ON f.project=vm.project AND f.agent=vm.agent AND f.path=vm.path
    WHERE vm.project=? AND vm.agent=? GROUP BY vm.community_id,f.language
    ORDER BY vm.community_id,n DESC,f.language LIMIT 20001`,
    [store.project, store.agent],
    20000,
    ['community_id', 'language'],
  );
  const result = new Map<string, string>();
  for (const row of rows) {
    const id = relativePath(text(row.community_id, 'community ID'));
    const language = optionalText(row.language, 'file language') ?? 'unknown';
    if (!result.has(id)) result.set(id, language);
  }
  return result;
}
