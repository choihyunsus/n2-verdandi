const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { MimirDatabase } = require('n2-mimir/storage');
const { GraphStore } = require('../dist/store');

test('shared schema preserves memory fields and accepts the published scoped semantic contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verdandi-schema-')),
    file = path.join(root, 'mimir.db');
  const memory = new MimirDatabase(file),
    connection = memory.reasoning.connection;
  let store;
  try {
    const columns = connection.query('PRAGMA table_info(experiences)');
    const source = memory.insertExperience({
      project: 'fixture',
      agent: 'worker',
      type: 'success',
      category: 'test',
      context: 'fixture',
      action: 'test',
      outcome: 'passed',
    });
    connection.execute(
      "INSERT INTO meta(key,value) VALUES('verdandi_semantic_schema_version','1')",
    );
    connection.execute(
      `CREATE TABLE verdandi_semantic_edges(project TEXT NOT NULL,agent TEXT NOT NULL,source_path TEXT NOT NULL,target_path TEXT NOT NULL,similarity REAL NOT NULL CHECK(similarity>=0 AND similarity<=1),edge_type TEXT NOT NULL DEFAULT 'semantic',model TEXT NOT NULL,computed_at INTEGER NOT NULL,PRIMARY KEY(project,agent,source_path,target_path))`,
    );
    connection.execute(
      "INSERT INTO verdandi_semantic_edges VALUES('other','other','a.ts','b.ts',0.9,'semantic','fixture',123)",
    );
    store = new GraphStore({ dbPath: file, project: 'fixture', agent: 'worker' });
    assert.deepEqual(connection.query('PRAGMA table_info(experiences)'), columns);
    assert.equal(memory.getExperience(source.id).outcome, 'passed');
    assert.equal(
      connection.query('SELECT computed_at FROM verdandi_semantic_edges')[0].computed_at,
      123,
    );
    assert.equal(
      connection.query("SELECT value FROM meta WHERE key='schema_version'")[0].value,
      '2',
    );
    assert.equal(store.memory.getStats().experiences, 1);
    const db = new Database(file);
    try {
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally {
      db.close();
    }
  } finally {
    store?.close();
    memory.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('unsupported module versions and unscoped legacy tables stop before module migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verdandi-version-')),
    file = path.join(root, 'mimir.db');
  const memory = new MimirDatabase(file),
    connection = memory.reasoning.connection;
  try {
    connection.execute("INSERT INTO meta(key,value) VALUES('verdandi_schema_version','future')");
    assert.throws(
      () => new GraphStore({ dbPath: file, project: 'fixture', agent: 'worker' }),
      /Unsupported/,
    );
    assert.equal(
      connection.query("SELECT value FROM meta WHERE key='verdandi_schema_version'")[0].value,
      'future',
    );
    assert.equal(
      connection.query("SELECT name FROM sqlite_master WHERE name='verdandi_scope_state'").length,
      0,
    );
    connection.execute("DELETE FROM meta WHERE key='verdandi_schema_version'");
    connection.execute('CREATE TABLE verdandi_communities(id TEXT PRIMARY KEY,size INTEGER)');
    connection.execute("INSERT INTO verdandi_communities VALUES('old',2)");
    assert.throws(
      () => new GraphStore({ dbPath: file, project: 'fixture', agent: 'worker' }),
      /ownership migration/,
    );
    assert.equal(connection.query('SELECT size FROM verdandi_communities')[0].size, 2);
  } finally {
    memory.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('a lone legacy document table also requires an explicit ownership migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verdandi-old-docs-')),
    file = path.join(root, 'mimir.db');
  const memory = new MimirDatabase(file);
  try {
    memory.reasoning.connection.execute(
      'CREATE TABLE verdandi_docs(path TEXT PRIMARY KEY,hash TEXT)',
    );
    memory.reasoning.connection.execute("INSERT INTO verdandi_docs VALUES('old.txt','preserved')");
    assert.throws(
      () => new GraphStore({ dbPath: file, project: 'fixture', agent: 'worker' }),
      /ownership migration/,
    );
    assert.equal(
      memory.reasoning.connection.query('SELECT hash FROM verdandi_docs')[0].hash,
      'preserved',
    );
    assert.equal(
      memory.reasoning.connection.query("SELECT 1 FROM meta WHERE key='verdandi_schema_version'")
        .length,
      0,
    );
  } finally {
    memory.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
