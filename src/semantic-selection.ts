// A bounded min-heap retains the strongest global edges with deterministic path tie-breaking.
import type { FileVector, SemanticEdge, SemanticSelection } from './semantic-types';

export const MAX_SEMANTIC_EDGES = 10000;
export const SEMANTIC_THRESHOLD = 0.65;

export function selectSemanticEdges(
  files: FileVector[],
  dirtyPaths: string[] | null,
  previous: SemanticEdge[],
): SemanticSelection {
  const dirty = dirtyPaths === null ? null : new Set(dirtyPaths);
  const heap: SemanticEdge[] = [];
  for (const edge of previous) retain(heap, edge);
  const now = Math.floor(Date.now() / 1000),
    deadline = Date.now() + 30000;
  let pairsCompared = 0,
    operations = 0;
  for (let source = 0; source < files.length; source++) {
    const left = files[source]!;
    if (dirty && !dirty.has(left.path)) continue;
    if (Date.now() > deadline) throw new Error('Semantic computation exceeded 30 seconds');
    for (let target = 0; target < files.length; target++) {
      const right = files[target]!;
      if (source === target || (target < source && (!dirty || dirty.has(right.path)))) continue;
      if (left.model !== right.model || left.values.length !== right.values.length) continue;
      operations += left.values.length;
      if (operations > 200000000)
        throw new Error('Semantic comparison exceeds 200 million dimensions');
      const similarity = cosine(left.values, right.values);
      pairsCompared++;
      if (similarity < SEMANTIC_THRESHOLD) continue;
      const [a, b] = [left.path, right.path].sort() as [string, string];
      retain(heap, { source: a, target: b, similarity, model: left.model, computedAt: now });
    }
  }
  return { edges: heap.sort((a, b) => -compareEdges(a, b)), pairsCompared };
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0,
    first = 0,
    second = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!;
    first += left[index]! ** 2;
    second += right[index]! ** 2;
  }
  if (!Number.isFinite(dot) || !first || !second)
    throw new Error('Invalid normalized semantic vector');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(first) / Math.sqrt(second)));
}

function compareEdges(left: SemanticEdge, right: SemanticEdge): number {
  if (left.similarity !== right.similarity) return left.similarity - right.similarity;
  if (left.source !== right.source) return left.source < right.source ? 1 : -1;
  return left.target < right.target ? 1 : left.target > right.target ? -1 : 0;
}

function retain(heap: SemanticEdge[], edge: SemanticEdge): void {
  if (heap.length < MAX_SEMANTIC_EDGES) {
    heap.push(edge);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEdges(heap[index]!, heap[parent]!) >= 0) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
      index = parent;
    }
    return;
  }
  if (compareEdges(edge, heap[0]!) <= 0) return;
  heap[0] = edge;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && compareEdges(heap[child + 1]!, heap[child]!) < 0) child++;
    if (compareEdges(heap[index]!, heap[child]!) <= 0) break;
    [heap[index], heap[child]] = [heap[child]!, heap[index]!];
    index = child;
  }
}
