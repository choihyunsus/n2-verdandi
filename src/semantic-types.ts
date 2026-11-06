// Typed semantic snapshots retain model space, source fingerprints and publication statistics.
export interface FileVector {
  path: string;
  model: string;
  values: Float32Array;
  hash: string;
}
export interface SemanticEdge {
  source: string;
  target: string;
  similarity: number;
  model: string;
  computedAt: number;
}
export interface SemanticSnapshot {
  files: FileVector[];
  model: string | null;
  excludedFiles: number;
  invalidChunks: number;
  revision: string;
}
export interface SemanticPlan {
  snapshot: SemanticSnapshot;
  dirty: string[] | null;
  previous: SemanticEdge[];
  strategy: 'full' | 'incremental';
}
export interface SemanticSelection {
  edges: SemanticEdge[];
  pairsCompared: number;
}
export interface SemanticResult {
  filesWithVectors: number;
  excludedFiles: number;
  invalidChunks: number;
  edgesStored: number;
  pairsCompared: number;
  model: string | null;
  strategy: SemanticPlan['strategy'];
  attempts: number;
}
export interface SemanticOptions {
  model?: string;
  force?: boolean;
  signal?: AbortSignal;
}
