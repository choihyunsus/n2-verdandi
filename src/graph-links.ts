// Read directional imports and semantic links within the selected owner and view boundary.
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { ViewEdge } from './graph-view-types';
import { boundedRows } from './graph-budget';

export interface LinkFilter {
  communityId?: string;
  nodePath?: string;
}

export function readLinks(store: GraphStore, filter: LinkFilter): ViewEdge[] {
  const imports = readImports(store, filter),
    semantic = readSemanticLinks(store, filter);
  if (imports.length + semantic.length > 100000)
    throw new Error('Graph view exceeds 100,000 links');
  return [...imports, ...semantic];
}

export function readImports(store: GraphStore, filter: LinkFilter): ViewEdge[] {
  const selection = selectBoundary(store, filter, 's.path', 't.path');
  const rows = boundedRows<Record<string, unknown>>(
    store.connection,
    `SELECT DISTINCT s.path AS source,t.path AS target,t.project,t.agent,d.dep_type
    FROM arachne_dependencies d JOIN arachne_files s ON s.id=d.source_file_id
    LEFT JOIN arachne_files t ON t.id=d.target_file_id WHERE s.project=? AND s.agent=?
    AND d.target_file_id IS NOT NULL ${selection.sql} ORDER BY source,target,d.dep_type LIMIT 100001`,
    [store.project, store.agent, ...selection.args],
    100000,
    ['source', 'target', 'dep_type'],
  );
  return rows.map((row) => {
    if (row.project !== store.project || row.agent !== store.agent)
      throw new Error('Import target is missing or belongs to another owner');
    return {
      source: relativePath(text(row.source, 'import source')),
      target: relativePath(text(row.target, 'import target')),
      type: 'import',
      dependencyType: text(row.dep_type, 'dependency type'),
    };
  });
}

export function readSemanticLinks(store: GraphStore, filter: LinkFilter): ViewEdge[] {
  const selection = selectBoundary(store, filter, 'source_path', 'target_path');
  return boundedRows<Record<string, unknown>>(
    store.connection,
    `SELECT source_path,target_path,similarity,model,computed_at FROM verdandi_semantic_edges
    WHERE project=? AND agent=? ${selection.sql} ORDER BY similarity DESC,source_path,target_path LIMIT 10001`,
    [store.project, store.agent, ...selection.args],
    10000,
    ['source_path', 'target_path', 'model'],
  ).map((row) => {
    if (
      typeof row.similarity !== 'number' ||
      !Number.isFinite(row.similarity) ||
      row.similarity < 0 ||
      row.similarity > 1
    )
      throw new Error('Invalid stored semantic similarity');
    return {
      source: relativePath(text(row.source_path, 'semantic source')),
      target: relativePath(text(row.target_path, 'semantic target')),
      type: 'semantic',
      similarity: row.similarity,
      model: text(row.model, 'semantic model'),
      computedAt: integer(row.computed_at, 'semantic timestamp'),
    };
  });
}

function selectBoundary(
  store: GraphStore,
  filter: LinkFilter,
  source: string,
  target: string,
): {
  sql: string;
  args: string[];
} {
  if (filter.nodePath !== undefined)
    return { sql: `AND (${source}=? OR ${target}=?)`, args: [filter.nodePath, filter.nodePath] };
  if (filter.communityId !== undefined) {
    const member = (field: string) => `EXISTS(SELECT 1 FROM verdandi_members vm WHERE
      vm.project=? AND vm.agent=? AND vm.community_id=? AND vm.path=${field})`;
    const scope = [store.project, store.agent, filter.communityId];
    return { sql: `AND ${member(source)} AND ${member(target)}`, args: [...scope, ...scope] };
  }
  return { sql: '', args: [] };
}
