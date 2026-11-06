// Public read paths cover scope, graph levels, literal filenames and current-input freshness.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Verdandi } = require('../dist/library');
const { fixture } = require('./helpers.cjs');

test('community lists, details and all three graph levels retain owner boundaries and literal paths', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath });
  try {
    f.write("한글 %2F'/a.ts", "import '../b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    f.write('isolate.ts', 'export const isolated=3;');
    await f.indexer.index(f.source);
    await client.build();
    f.other.upsertFile('foreign.ts', 'foreign', 'python', 1, '2026-01-01');
    const other = new Verdandi({ ...f.scope, agent: 'other', dbPath: f.dbPath });
    try {
      await other.build();
    } finally {
      await other.close();
    }
    const page = client.communities(1, 0);
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].size, 2);
    assert.equal(client.communities(1, 1).items[0].size, 1);
    const detail = client.community(page.items[0].id);
    assert.deepEqual(
      new Set(detail.members.map((member) => member.path)),
      new Set(["한글 %2F'/a.ts", 'b.ts']),
    );
    const overview = client.graph(0),
      community = client.graph(1, detail.id),
      node = client.graph(2, "한글 %2F'/a.ts");
    assert.equal(overview.level, 0);
    assert.equal(overview.nodes.length, 2);
    assert.equal(
      overview.nodes.some((entry) => entry.id === 'foreign.ts'),
      false,
    );
    assert.equal(overview.nodes.find((entry) => entry.id === detail.id).language, 'ts');
    assert.equal(community.level, 1);
    assert.equal(community.edges[0].type, 'import');
    assert.equal(node.level, 2);
    assert.equal(node.center, "한글 %2F'/a.ts");
    assert.equal(node.nodes.find((entry) => entry.type === 'center').id, node.center);
    assert.equal(node.stale, false);
    assert.equal(node.coverage, 'complete');
    assert.equal(client.graph(2, 'foreign.ts'), null);
    assert.equal(client.community('foreign.ts'), null);
    assert.throws(() => client.graph(3), /level/);
    assert.throws(() => client.graph(1, '../outside'), /components/);
    assert.throws(() => client.communities(0), /positive/);
  } finally {
    await client.close();
    f.close();
  }
});

test('backlinks combine incoming imports, recency-weighted semantics and scoped community peers', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath });
  try {
    f.write('a.ts', "import './b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    f.write('c.ts', 'export const c=3;');
    await f.indexer.index(f.source);
    const now = Math.floor(Date.now() / 1000);
    const insert = f.arachne.db.prepare(
      'INSERT INTO verdandi_semantic_edges VALUES(?,?,?,?,?,?,?,?)',
    );
    insert.run(
      f.scope.project,
      f.scope.agent,
      'a.ts',
      'b.ts',
      0.99,
      'semantic',
      'fixture-model',
      now - 86400 * 1000,
    );
    insert.run(
      f.scope.project,
      f.scope.agent,
      'b.ts',
      'c.ts',
      0.8,
      'semantic',
      'fixture-model',
      now,
    );
    insert.run(f.scope.project, 'other', 'b.ts', 'foreign.ts', 1, 'semantic', 'foreign-model', now);
    await client.build();
    const result = client.backlinks('b.ts', { limit: 1 });
    assert.equal(result.totals.imports, 1);
    assert.deepEqual(result.importBacklinks, [{ path: 'a.ts', type: 'import' }]);
    assert.equal(result.totals.semantic, 2);
    assert.equal(result.semanticNeighbors[0].path, 'c.ts');
    assert.ok(result.semanticNeighbors[0].hybridScore <= 0.8);
    assert.equal(
      result.communityPeers.some((peer) => peer.path === 'foreign.ts'),
      false,
    );
    assert.equal(client.backlinks('b.ts', { includeSemantic: false }).semanticNeighbors.length, 0);
    assert.equal(client.backlinks('missing.ts'), null);
    assert.throws(() => client.backlinks('b.ts', { limit: 1001 }), /limit/);
    f.store.connection.execute('DROP TABLE verdandi_semantic_edges');
    assert.equal(client.backlinks('b.ts', { includeSemantic: false }).importBacklinks.length, 1);
    assert.throws(() => client.backlinks('b.ts'), /verdandi_semantic_edges/);
  } finally {
    await client.close();
    f.close();
  }
});

test('status distinguishes an unindexed owner and notices dependency-only changes', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath });
  const unindexed = new Verdandi({ project: 'unindexed', agent: 'unindexed', dbPath: f.dbPath });
  try {
    assert.equal(unindexed.status().indexed, false);
    assert.equal(unindexed.status().currentRevision, null);
    assert.equal(unindexed.graph(0).nodes.length, 0);
    f.write('a.ts', "import './b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    await f.indexer.index(f.source);
    await client.build();
    assert.equal(client.status().stale, false);
    f.arachne.clearDependencies(f.arachne.getFileByPath('a.ts').id);
    assert.equal(client.status().stale, true);
    assert.equal(client.graph(0).stale, true);
    assert.equal(client.graph(1, client.communities().items[0].id).edges.length, 0);
    await client.build();
    assert.equal(client.status().stale, false);
    f.arachne._setMeta('last_scan_complete', 'false');
    assert.equal(client.status().coverage, 'partial');
  } finally {
    await client.close();
    await unindexed.close();
    f.close();
  }
});

test('stored read corruption surfaces as an error instead of a successful empty response', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath });
  try {
    f.write('a.ts', 'export const a=1;');
    await f.indexer.index(f.source);
    await client.build();
    f.arachne.db.prepare("UPDATE arachne_files SET language=zeroblob(2) WHERE path='a.ts'").run();
    assert.throws(() => client.graph(0), /language/);
    assert.throws(() => client.graph(1, 'a.ts'), /language/);
    assert.throws(() => client.graph(2, 'a.ts'), /language/);
    f.arachne.db.prepare("UPDATE arachne_files SET language='ts' WHERE path='a.ts'").run();
    f.store.connection.execute("UPDATE verdandi_communities SET size=2 WHERE id='a.ts'");
    assert.throws(() => client.community('a.ts'), /does not match/);
    f.arachne._setMeta('last_scan_complete', 'invalid');
    assert.throws(() => client.status(), /coverage/);
  } finally {
    await client.close();
    f.close();
  }
});
