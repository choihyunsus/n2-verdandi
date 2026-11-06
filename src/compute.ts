// Keep status and cancellation responsive while the worker performs bounded clustering.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ClusterResult, GraphInput } from './graph-types';
import { validateGraphBudget } from './graph-budget';
import type { SemanticPlan, SemanticSelection } from './semantic-types';

export async function computeClusters(
  graph: GraphInput,
  referenceWeight: number,
  signal?: AbortSignal,
): Promise<ClusterResult> {
  signal?.throwIfAborted();
  validateGraphBudget(graph);
  return runWorker<ClusterResult>({ kind: 'cluster', graph, referenceWeight }, signal);
}

export function computeSemantic(
  plan: SemanticPlan,
  signal?: AbortSignal,
): Promise<SemanticSelection> {
  return runWorker<SemanticSelection>(
    { kind: 'semantic', files: plan.snapshot.files, dirty: plan.dirty, previous: plan.previous },
    signal,
  );
}

async function runWorker<T>(input: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const worker = new Worker(path.join(__dirname, 'compute-worker.js'), {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  });
  let timer: NodeJS.Timeout | undefined;
  let abort = (): void => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal?.reason ?? new Error('Graph computation aborted'));
      timer = setTimeout(() => reject(new Error('Graph computation exceeded 30 seconds')), 30000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('error', reject);
      worker.once('exit', (code) =>
        reject(new Error(`Graph worker exited without a result (${code})`)),
      );
      worker.once('message', (message: { result?: T; error?: string }) => {
        if (message.error || !message.result)
          reject(new Error(message.error ?? 'Missing graph result'));
        else resolve(message.result);
      });
      if (signal?.aborted) abort();
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await worker.terminate();
  }
}
