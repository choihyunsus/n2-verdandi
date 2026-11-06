// Supplement incremental hints with exact source/vector hashes and fall back at the edge cap.
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { SemanticEdge, SemanticOptions, SemanticPlan } from './semantic-types';
import { readSemanticSnapshot } from './semantic-vectors';
import { boundedRows } from './graph-budget';
import { MAX_SEMANTIC_EDGES, SEMANTIC_THRESHOLD } from './semantic-selection';

export function readSemanticPlan(store: GraphStore, options: SemanticOptions): SemanticPlan {
  return store.connection.transaction(() => {
    const snapshot = readSemanticSnapshot(store, options.model);
    const previous = readPreviousVectors(store),
      oldCount = previous.size;
    const dirty = new Set<string>();
    for (const file of snapshot.files) {
      const state = previous.get(file.path);
      if (state?.hash !== file.hash || state.model !== file.model) dirty.add(file.path);
      previous.delete(file.path);
    }
    for (const path of previous.keys()) dirty.add(path);
    const edges = readSemanticEdges(store);
    const published = store.connection.query<{ model: unknown; input_revision: unknown }>(
      'SELECT model,input_revision FROM verdandi_semantic_build WHERE project=? AND agent=?',
      [store.project, store.agent],
    )[0];
    const incremental =
      !options.force &&
      oldCount > 0 &&
      published?.model === snapshot.model &&
      text(published.input_revision, 'semantic build revision').split(':')[2] ===
        snapshot.revision.split(':')[2] &&
      dirty.size * 10 < snapshot.files.length * 3 &&
      edges.length < MAX_SEMANTIC_EDGES;
    const files = new Map(snapshot.files.map((file) => [file.path, file]));
    const preserved = edges.filter((edge) => {
      const first = files.get(edge.source),
        second = files.get(edge.target);
      return (
        !dirty.has(edge.source) &&
        !dirty.has(edge.target) &&
        first &&
        second &&
        first.model === edge.model &&
        second.model === edge.model &&
        first.values.length === second.values.length &&
        edge.similarity >= SEMANTIC_THRESHOLD
      );
    });
    return {
      snapshot,
      dirty: incremental ? [...dirty] : null,
      previous: incremental ? preserved : [],
      strategy: incremental ? 'incremental' : 'full',
    };
  });
}

function readPreviousVectors(store: GraphStore): Map<string, { model: string; hash: string }> {
  const rows = boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT path,model,vector_hash FROM verdandi_semantic_state WHERE project=? AND agent=? LIMIT 20001',
    [store.project, store.agent],
    20000,
    ['path', 'model', 'vector_hash'],
  );
  return new Map(
    rows.map((row) => [
      relativePath(text(row.path, 'semantic state path')),
      {
        model: text(row.model, 'semantic state model'),
        hash: text(row.vector_hash, 'vector hash'),
      },
    ]),
  );
}

export function readSemanticEdges(store: GraphStore): SemanticEdge[] {
  return boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT * FROM verdandi_semantic_edges WHERE project=? AND agent=? ORDER BY source_path,target_path LIMIT 10001',
    [store.project, store.agent],
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
    const source = relativePath(text(row.source_path, 'semantic source'));
    const target = relativePath(text(row.target_path, 'semantic target'));
    if (source >= target)
      throw new Error('Semantic edges require canonical, distinct endpoint ordering');
    return {
      source,
      target,
      similarity: row.similarity,
      model: text(row.model, 'semantic model'),
      computedAt: integer(row.computed_at, 'semantic timestamp'),
    };
  });
}
