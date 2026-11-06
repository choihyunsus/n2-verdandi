// Read owned Arachne and semantic inputs from one transaction before CPU-heavy clustering.
import { createHash } from 'node:crypto';
import { integer, optionalText, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { GraphInput, GraphNode } from './graph-types';
import { boundedRows, MAX_GRAPH_TEXT_BYTES, validateGraphBudget } from './graph-budget';
import { initializeSourceTriggers } from './source-triggers';

export interface GraphSnapshot {
  graph: GraphInput;
  topologyHash: string;
  nodeHashes: Array<{ path: string; hash: string }>;
  revision: string;
  coverage: 'complete' | 'partial' | 'unknown';
}

export function readGraphSnapshot(store: GraphStore): GraphSnapshot {
  return store.connection.transaction(() => {
    assertArachneSchema(store);
    const budget = { remaining: MAX_GRAPH_TEXT_BYTES };
    const graph = { nodes: readNodes(store, budget), edges: [] } as GraphInput;
    const paths = new Set(graph.nodes.map((node) => node.path));
    const edges = new Map<string, { source: string; target: string }>();
    for (const [source, target] of [
      ...readImports(store, budget),
      ...readSemantic(store, budget),
    ]) {
      if (source === target || !paths.has(source) || !paths.has(target)) continue;
      const pair = [source, target].sort() as [string, string];
      edges.set(JSON.stringify(pair), { source: pair[0], target: pair[1] });
    }
    if (edges.size > 100000) throw new Error('Graph exceeds 100,000 edges');
    graph.edges = [...edges.values()].sort(
      (a, b) => compare(a.source, b.source) || compare(a.target, b.target),
    );
    validateGraphBudget(graph);
    const nodeHashes = hashNodes(graph);
    const topologyHash = hash(JSON.stringify(['verdandi-graph-v1', nodeHashes]));
    const metadata = store.connection.query<{ value: unknown }>(
      "SELECT value FROM arachne_metadata WHERE project=? AND agent=? AND key='last_scan_complete'",
      [store.project, store.agent],
    )[0];
    if (metadata && metadata.value !== 'true' && metadata.value !== 'false')
      throw new Error('Invalid stored index coverage');
    return {
      graph,
      nodeHashes,
      topologyHash,
      revision: inputRevision(store),
      coverage:
        metadata?.value === 'false'
          ? 'partial'
          : metadata?.value === 'true'
            ? 'complete'
            : 'unknown',
    };
  });
}

export function inputRevision(store: GraphStore): string {
  const row = store.connection.query<{ source: unknown; semantic: unknown; dependency: unknown }>(
    `SELECT COALESCE((SELECT revision FROM arachne_scope_state WHERE project=? AND agent=?),0) AS source,
    semantic_revision AS semantic,
    (SELECT dependency_revision FROM verdandi_input_state WHERE project=? AND agent=?) AS dependency
    FROM verdandi_scope_state WHERE project=? AND agent=?`,
    [store.project, store.agent, store.project, store.agent, store.project, store.agent],
  )[0];
  if (!row) throw new Error('Verdandi scope state is missing');
  return `${integer(row.source, 'Arachne revision')}:${integer(row.semantic, 'semantic revision')}:${integer(row.dependency, 'dependency revision')}`;
}

export function assertArachneSchema(store: GraphStore): void {
  const version = store.connection.query<{ value: unknown }>(
    "SELECT value FROM meta WHERE key='arachne_schema_version'",
  )[0];
  if (version?.value !== '1')
    throw new Error('Arachne 5 scoped schema is required. Index the project with Arachne first.');
  initializeSourceTriggers(store.connection);
}

function readNodes(store: GraphStore, budget: { remaining: number }): GraphNode[] {
  const rows = boundedRows<{ path: unknown; language: unknown }>(
    store.connection,
    `SELECT path,language FROM arachne_files WHERE project=? AND agent=?
    AND lower(COALESCE(language,'')) NOT IN ('md','txt') ORDER BY path LIMIT 20001`,
    [store.project, store.agent],
    20000,
    ['path', 'language'],
    budget,
  );
  return rows
    .map((row) => ({
      path: checkedPath(row.path),
      language: optionalText(row.language, 'file language'),
    }))
    .sort((left, right) => compare(left.path, right.path));
}

function readImports(store: GraphStore, budget: { remaining: number }): Array<[string, string]> {
  const rows = boundedRows<Record<string, unknown>>(
    store.connection,
    `SELECT s.path AS source,d.target_file_id,t.path AS target,t.project,t.agent
    FROM arachne_dependencies d JOIN arachne_files s ON s.id=d.source_file_id
    LEFT JOIN arachne_files t ON t.id=d.target_file_id WHERE s.project=? AND s.agent=? LIMIT 100001`,
    [store.project, store.agent],
    100000,
    ['source', 'target', 'project', 'agent'],
    budget,
  );
  const pairs: Array<[string, string]> = [];
  for (const row of rows) {
    const source = checkedPath(row.source);
    if (row.target_file_id === null) continue;
    integer(row.target_file_id, 'dependency target ID');
    if (row.project !== store.project || row.agent !== store.agent)
      throw new Error('Dependency target is missing or belongs to another owner');
    pairs.push([source, checkedPath(row.target)]);
  }
  return pairs;
}

function readSemantic(store: GraphStore, budget: { remaining: number }): Array<[string, string]> {
  const rows = boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT source_path,target_path,similarity FROM verdandi_semantic_edges WHERE project=? AND agent=? LIMIT 10001',
    [store.project, store.agent],
    10000,
    ['source_path', 'target_path'],
    budget,
  );
  return rows.map((row) => {
    if (
      typeof row.similarity !== 'number' ||
      !Number.isFinite(row.similarity) ||
      row.similarity < 0 ||
      row.similarity > 1
    )
      throw new Error('Invalid semantic similarity');
    return [checkedPath(row.source_path), checkedPath(row.target_path)];
  });
}

function hashNodes(graph: GraphInput): GraphSnapshot['nodeHashes'] {
  const adjacency = new Map(graph.nodes.map((node) => [node.path, [] as string[]]));
  for (const edge of graph.edges) {
    adjacency.get(edge.source)!.push(edge.target);
    adjacency.get(edge.target)!.push(edge.source);
  }
  return graph.nodes.map((node) => ({
    path: node.path,
    hash: hash(JSON.stringify([node.path, node.language, adjacency.get(node.path)!.sort()])),
  }));
}

function checkedPath(value: unknown): string {
  const original = text(value, 'file path'),
    normalized = relativePath(original);
  if (normalized !== original) throw new Error('Stored graph paths must use normalized separators');
  return original;
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
