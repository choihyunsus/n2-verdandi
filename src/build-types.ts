// Shared plan and result contracts retain counts, provenance and index coverage.
import type { GraphInput } from './graph-types';
import type { GraphSnapshot } from './graph-input';

export interface BuildState {
  topologyHash: string;
  inputRevision: string;
  edgeCount: number;
  modularity: number;
  builtAt: number;
}

export interface StoredMember {
  path: string;
  communityId: string;
  degree: number;
}

export interface BuildPlan {
  snapshot: GraphSnapshot;
  strategy: 'full' | 'incremental' | 'no_changes';
  selected: GraphInput;
  affected: string[];
  previousMembers: StoredMember[];
  previous?: BuildState;
}

export interface BuildResult {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  memberCount: number;
  bridgeCount: number;
  modularity: number;
  strategy: BuildPlan['strategy'];
  coverage: GraphSnapshot['coverage'];
  inputRevision: string;
  topologyHash: string;
  attempts: number;
}
