// Document learning keeps source content, screening policy and memory references explicit.
export interface DocumentChunk {
  path: string;
  hash: string;
  index: number;
  total: number;
  text: string;
}
export interface LearnOptions {
  signal?: AbortSignal;
  policyId?: string;
  screen?: (chunk: DocumentChunk, signal: AbortSignal) => boolean | Promise<boolean>;
}
export interface DocumentInput {
  path: string;
  filename: string;
  requested: string;
  rawHash: string;
  hash: string;
  policyId: string;
  chunks: string[];
}
export interface LearnResult {
  path: string;
  hash: string;
  policyId: string;
  status: 'learned' | 'already_learned';
  chunks: number;
  rejectedChunks: number;
  sourceIds: string[];
  insightIds: string[];
  verified: false;
}
