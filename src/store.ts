// Scope-bound storage reuses Mimir initialization, migration and transaction semantics.
import fs from 'node:fs';
import path from 'node:path';
import { MimirDatabase } from 'n2-mimir/storage';
import { scopeName } from 'n2-arachne/dist/lib/store-values.js';
import { initializeSchema } from './schema';
import { initializeSourceTriggers } from './source-triggers';
import { bindSourceRoot } from './source-root';
import type { SqlConnection, VerdandiOptions } from './storage-types';

export class GraphStore {
  readonly memory: MimirDatabase;
  readonly connection: SqlConnection;
  readonly project: string;
  readonly agent: string;
  readonly dbPath: string;
  readonly projectRoot?: string;

  constructor(options: VerdandiOptions) {
    this.project = scopeName(options.project);
    this.agent = scopeName(options.agent);
    if (typeof options.dbPath !== 'string' || !options.dbPath || options.dbPath.includes('\0'))
      throw new Error('An explicit database path is required');
    this.dbPath = options.dbPath === ':memory:' ? options.dbPath : path.resolve(options.dbPath);
    this.projectRoot =
      options.projectRoot === undefined ? undefined : fs.realpathSync(options.projectRoot);
    if (this.projectRoot && !fs.statSync(this.projectRoot).isDirectory())
      throw new Error('Project root must be a directory');
    if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.memory = new MimirDatabase(this.dbPath);
    this.connection = this.memory.reasoning.connection;
    try {
      initializeSchema(this.connection);
      this.connection.execute(
        'INSERT OR IGNORE INTO verdandi_scope_state(project,agent) VALUES(?,?)',
        [this.project, this.agent],
      );
      this.connection.execute(
        'INSERT OR IGNORE INTO verdandi_input_state(project,agent) VALUES(?,?)',
        [this.project, this.agent],
      );
      if (
        this.connection.query<{ value: unknown }>(
          "SELECT value FROM meta WHERE key='arachne_schema_version'",
        )[0]?.value === '1'
      )
        initializeSourceTriggers(this.connection);
      bindSourceRoot(this);
    } catch (error) {
      this.memory.close();
      throw error;
    }
  }

  close(): void {
    this.memory.close();
  }
}
