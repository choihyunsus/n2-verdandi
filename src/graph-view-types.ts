// Three graph levels use the existing viewer's portable JSON field names.
export interface ViewNode {
  id: string;
  type: 'community' | 'file' | 'center' | 'neighbor';
  language: string;
  size?: number;
  degree?: number;
  internal_edges?: number;
}
export interface ViewEdge {
  source: string;
  target: string;
  type: 'bridge' | 'import' | 'semantic';
  weight?: number;
  similarity?: number;
  model?: string;
  computedAt?: number;
  dependencyType?: string;
}
export interface GraphView {
  level: 0 | 1 | 2;
  nodes: ViewNode[];
  edges: ViewEdge[];
  community_id?: string;
  center?: string;
  stale: boolean;
  semanticStale: boolean;
  coverage: 'complete' | 'partial' | 'unknown';
}
