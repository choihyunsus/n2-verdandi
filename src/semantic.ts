// Build semantic links outside write transactions and publish only a current, leased snapshot.
import type { GraphStore } from './store';
import type {
  SemanticOptions,
  SemanticPlan,
  SemanticResult,
  SemanticSelection,
} from './semantic-types';
import { acquireLease, assertLease, releaseLease, type JobLease } from './job-lease';
import { computeSemantic } from './compute';
import { readSemanticPlan } from './semantic-plan';
import { semanticRevision } from './semantic-vectors';

export async function buildSemantic(
  store: GraphStore,
  options: SemanticOptions = {},
): Promise<SemanticResult> {
  if (options.force !== undefined && typeof options.force !== 'boolean')
    throw new Error('force must be a boolean');
  options.signal?.throwIfAborted();
  const lease = acquireLease(store, 'semantic');
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      options.signal?.throwIfAborted();
      const plan = readSemanticPlan(store, options);
      const selected = await computeSemantic(plan, options.signal);
      options.signal?.throwIfAborted();
      if (publishSemantic(store, lease, plan, selected, options.signal))
        return {
          filesWithVectors: plan.snapshot.files.length,
          excludedFiles: plan.snapshot.excludedFiles,
          invalidChunks: plan.snapshot.invalidChunks,
          edgesStored: selected.edges.length,
          pairsCompared: selected.pairsCompared,
          model: plan.snapshot.model,
          strategy: plan.strategy,
          attempts: attempt,
        };
    }
    throw new Error(
      'Semantic inputs changed during three build attempts; retry after embedding finishes',
    );
  } finally {
    releaseLease(store, lease);
  }
}

function publishSemantic(
  store: GraphStore,
  lease: JobLease,
  plan: SemanticPlan,
  selected: SemanticSelection,
  signal?: AbortSignal,
): boolean {
  return store.connection.transaction(() => {
    signal?.throwIfAborted();
    assertLease(store, lease);
    if (semanticRevision(store) !== plan.snapshot.revision) return false;
    if (plan.dirty?.length !== 0) replaceSemanticRows(store, plan, selected);
    const scope = [store.project, store.agent];
    store.connection.execute(
      `INSERT INTO verdandi_semantic_build VALUES(?,?,?,?,?) ON CONFLICT(project,agent)
      DO UPDATE SET model=excluded.model,input_revision=excluded.input_revision,built_at=excluded.built_at`,
      [...scope, plan.snapshot.model, semanticRevision(store), Math.floor(Date.now() / 1000)],
    );
    return true;
  });
}

function replaceSemanticRows(
  store: GraphStore,
  plan: SemanticPlan,
  selected: SemanticSelection,
): void {
  const scope = [store.project, store.agent];
  store.connection.execute(
    'DELETE FROM verdandi_semantic_edges WHERE project=? AND agent=?',
    scope,
  );
  store.connection.execute(
    'DELETE FROM verdandi_semantic_state WHERE project=? AND agent=?',
    scope,
  );
  for (const edge of selected.edges)
    store.connection.execute(
      `INSERT INTO verdandi_semantic_edges(project,agent,source_path,target_path,similarity,edge_type,model,computed_at)
      VALUES(?,?,?,?,?,'semantic',?,?)`,
      [...scope, edge.source, edge.target, edge.similarity, edge.model, edge.computedAt],
    );
  for (const file of plan.snapshot.files)
    store.connection.execute('INSERT INTO verdandi_semantic_state VALUES(?,?,?,?,?)', [
      ...scope,
      file.path,
      file.model,
      file.hash,
    ]);
}
