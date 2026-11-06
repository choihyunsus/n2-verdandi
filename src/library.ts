// Standalone library entry point shared by the CLI, MCP and local viewer.
export { Verdandi } from './engine';
export { clusterGraph } from './cluster';
export type { VerdandiOptions, Scope } from './storage-types';
export type { BuildOptions } from './builder';
export type { BuildResult } from './build-types';
export type { GraphInput, GraphNode, GraphEdge, ClusterResult } from './graph-types';
export type { SemanticOptions, SemanticResult, SemanticEdge } from './semantic-types';
export type { LearnOptions, LearnResult, DocumentChunk } from './document-types';
export type { VerdandiStatus } from './status';
export type { CommunitySummary, CommunityDetail } from './graph-read';
export type { GraphView, ViewNode, ViewEdge } from './graph-view-types';
export type { BacklinkOptions } from './backlinks';
export { startGraphViewer } from './http';
export type { GraphViewer } from './http';
