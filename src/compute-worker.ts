// CPU work runs in an isolated thread with a parent-controlled deadline and memory ceiling.
import { parentPort, workerData } from 'node:worker_threads';
import { clusterGraph } from './cluster';
import type { GraphInput } from './graph-types';
import { selectSemanticEdges } from './semantic-selection';
import type { FileVector, SemanticEdge } from './semantic-types';

type Input =
  | { kind: 'cluster'; graph: GraphInput; referenceWeight: number }
  | { kind: 'semantic'; files: FileVector[]; dirty: string[] | null; previous: SemanticEdge[] };
const input = workerData as Input;
try {
  const result =
    input.kind === 'cluster'
      ? clusterGraph(input.graph, input.referenceWeight)
      : selectSemanticEdges(input.files, input.dirty, input.previous);
  parentPort?.postMessage({ result });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
