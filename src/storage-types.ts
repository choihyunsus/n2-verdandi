// Use the same transactional connection that Mimir exposes for module extensions.
import type { MimirDatabase } from 'n2-mimir/storage';

export type SqlConnection = MimirDatabase['reasoning']['connection'];
export interface Scope {
  project: string;
  agent: string;
}
export interface VerdandiOptions extends Scope {
  dbPath: string;
  projectRoot?: string;
}
