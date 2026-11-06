// Structural graph inputs and the weighted representation used during coarsening.
export interface GraphNode {
  path: string;
  language: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WeightedGraph {
  paths: string[];
  adjacency: Array<Map<number, number>>;
  degrees: number[];
  totalWeight: number;
}

export interface ClusterResult {
  communities: Array<{ id: string; members: string[] }>;
  modularity: number;
  levels: number;
}
