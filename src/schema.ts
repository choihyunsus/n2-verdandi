// Additive scoped tables retain the published Skuld semantic-edge contract.
import type { SqlConnection } from './storage-types';
import { initializeSemanticTriggers } from './input-triggers';

export function initializeSchema(connection: SqlConnection): void {
  connection.transaction(() => {
    validateVersion(connection, 'verdandi_schema_version', 'verdandi_communities');
    validateVersion(connection, 'verdandi_semantic_schema_version', 'verdandi_semantic_edges');
    validateOwnedTables(connection);
    for (const statement of STATEMENTS) connection.execute(statement);
    initializeSemanticTriggers(connection);
    for (const key of ['verdandi_schema_version', 'verdandi_semantic_schema_version'])
      connection.execute('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)', [key, '1']);
  });
}

function validateOwnedTables(connection: SqlConnection): void {
  const versioned =
    connection.query("SELECT 1 FROM meta WHERE key='verdandi_schema_version'").length > 0;
  const tables = connection.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'verdandi_*'",
  );
  for (const table of tables) {
    if (table.name === 'verdandi_semantic_edges') continue;
    if (!versioned)
      throw new Error(`Unversioned ${table.name} requires explicit ownership migration`);
    const columns = connection.query<{ name: string }>('SELECT name FROM pragma_table_info(?)', [
      table.name,
    ]);
    if (!['project', 'agent'].every((name) => columns.some((column) => column.name === name)))
      throw new Error(`Unscoped ${table.name} requires explicit ownership migration`);
  }
}

function validateVersion(connection: SqlConnection, key: string, table: string): void {
  const version = connection.query<{ value: unknown }>('SELECT value FROM meta WHERE key=?', [
    key,
  ])[0];
  if (version && version.value !== '1') throw new Error(`Unsupported ${key}`);
  const exists =
    connection.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]).length >
    0;
  if (exists && !version)
    throw new Error(`Unversioned ${table} requires explicit ownership migration`);
  if (exists) {
    const columns = connection.query<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!['project', 'agent'].every((name) => columns.some((column) => column.name === name)))
      throw new Error(`Unscoped ${table} requires explicit ownership migration`);
  }
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS verdandi_roots (
    project TEXT NOT NULL, agent TEXT NOT NULL, root TEXT NOT NULL, PRIMARY KEY(project,agent))`,
  `CREATE TABLE IF NOT EXISTS verdandi_input_state (
    project TEXT NOT NULL, agent TEXT NOT NULL,
    dependency_revision INTEGER NOT NULL DEFAULT 0, vector_revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project,agent))`,
  `CREATE TABLE IF NOT EXISTS verdandi_jobs (
    project TEXT NOT NULL, agent TEXT NOT NULL, kind TEXT NOT NULL,
    lease_id TEXT NOT NULL, process_id INTEGER NOT NULL CHECK(process_id>0),
    started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(project,agent,kind))`,
  `CREATE TABLE IF NOT EXISTS verdandi_scope_state (
    project TEXT NOT NULL, agent TEXT NOT NULL,
    semantic_revision INTEGER NOT NULL DEFAULT 0, graph_revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project,agent))`,
  `CREATE TABLE IF NOT EXISTS verdandi_communities (
    project TEXT NOT NULL, agent TEXT NOT NULL, id TEXT NOT NULL,
    size INTEGER NOT NULL CHECK(size>0), internal_edges INTEGER NOT NULL CHECK(internal_edges>=0),
    built_at INTEGER NOT NULL, PRIMARY KEY(project,agent,id))`,
  `CREATE TABLE IF NOT EXISTS verdandi_members (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, community_id TEXT NOT NULL,
    degree INTEGER NOT NULL CHECK(degree>=0), PRIMARY KEY(project,agent,path),
    FOREIGN KEY(project,agent,community_id) REFERENCES verdandi_communities(project,agent,id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS verdandi_bridges (
    project TEXT NOT NULL, agent TEXT NOT NULL, src_community TEXT NOT NULL, dst_community TEXT NOT NULL,
    weight INTEGER NOT NULL CHECK(weight>0), PRIMARY KEY(project,agent,src_community,dst_community),
    FOREIGN KEY(project,agent,src_community) REFERENCES verdandi_communities(project,agent,id) ON DELETE CASCADE,
    FOREIGN KEY(project,agent,dst_community) REFERENCES verdandi_communities(project,agent,id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS verdandi_build_state (
    project TEXT NOT NULL, agent TEXT NOT NULL, topology_hash TEXT NOT NULL, input_revision TEXT NOT NULL,
    edge_count INTEGER NOT NULL CHECK(edge_count>=0), modularity REAL NOT NULL, built_at INTEGER NOT NULL,
    PRIMARY KEY(project,agent))`,
  `CREATE TABLE IF NOT EXISTS verdandi_node_state (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, topology_hash TEXT NOT NULL,
    PRIMARY KEY(project,agent,path))`,
  `CREATE TABLE IF NOT EXISTS verdandi_dirty (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, reason TEXT NOT NULL,
    detected_at INTEGER NOT NULL DEFAULT(unixepoch()), PRIMARY KEY(project,agent,path))`,
  `CREATE TABLE IF NOT EXISTS verdandi_semantic_edges (
    project TEXT NOT NULL, agent TEXT NOT NULL, source_path TEXT NOT NULL, target_path TEXT NOT NULL,
    similarity REAL NOT NULL CHECK(similarity>=0 AND similarity<=1), edge_type TEXT NOT NULL DEFAULT 'semantic',
    model TEXT NOT NULL, computed_at INTEGER NOT NULL,
    PRIMARY KEY(project,agent,source_path,target_path))`,
  `CREATE INDEX IF NOT EXISTS idx_verdandi_semantic_scope
    ON verdandi_semantic_edges(project,agent,source_path,similarity DESC,target_path)`,
  `CREATE TABLE IF NOT EXISTS verdandi_semantic_state (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, model TEXT NOT NULL, vector_hash TEXT NOT NULL,
    PRIMARY KEY(project,agent,path))`,
  `CREATE TABLE IF NOT EXISTS verdandi_semantic_build (
    project TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, input_revision TEXT NOT NULL,
    built_at INTEGER NOT NULL, PRIMARY KEY(project,agent))`,
  `CREATE TABLE IF NOT EXISTS verdandi_docs (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    chunks INTEGER NOT NULL CHECK(chunks>0), learned_at INTEGER NOT NULL,
    PRIMARY KEY(project,agent,path))`,
  `CREATE TABLE IF NOT EXISTS verdandi_doc_receipts (
    project TEXT NOT NULL, agent TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    chunks INTEGER NOT NULL CHECK(chunks>0), source_ids_json TEXT NOT NULL, insight_ids_json TEXT NOT NULL,
    learned_at INTEGER NOT NULL, PRIMARY KEY(project,agent,path,hash,policy_id))`,
  `CREATE INDEX IF NOT EXISTS idx_verdandi_members_community
    ON verdandi_members(project,agent,community_id,degree DESC,path)`,
];
