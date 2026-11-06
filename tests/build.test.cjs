// Exercise real Arachne input, worker computation and common-database publication.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGraph } = require('../dist/builder');
const { readBuildPlan } = require('../dist/build-plan');
const { Verdandi } = require('../dist/library');
const { fixture } = require('./helpers.cjs');

function rows(f, table) {
  return f.store.connection.query(
    `SELECT * FROM ${table} WHERE project=? AND agent=? ORDER BY 1,2,3`,
    [f.scope.project, f.scope.agent],
  );
}

test('public build publishes complete scoped graphs and retains accurate no-change counts across restart', async () => {
  const f = await fixture();
  let engine;
  try {
    f.write("한글 %'/a.ts", "import '../b'; export const alpha=1;");
    f.write('b.ts', 'export const beta=2;');
    f.write('isolated.ts', 'export const isolated=1;');
    await f.indexer.index(f.source);
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    const first = await engine.build();
    assert.equal(first.nodeCount, 3);
    assert.equal(first.edgeCount, 1);
    assert.equal(first.communityCount, 2);
    assert.equal(first.memberCount, 3);
    assert.equal(first.strategy, 'full');
    assert.equal(first.coverage, 'complete');
    assert.equal(engine.status().stale, false);
    assert.equal(rows(f, 'verdandi_dirty').length, 0);
    await engine.close();
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    const second = await engine.build();
    assert.equal(second.strategy, 'no_changes');
    assert.equal(second.communityCount, first.communityCount);
    assert.equal(second.memberCount, first.memberCount);
    f.arachne._setMeta('last_scan_complete', 'false');
    assert.equal((await engine.build()).coverage, 'partial');
    f.other.upsertFile('foreign.ts', 'foreign', 'ts', 1, '2026-01-01');
    const other = new Verdandi({ ...f.scope, agent: 'other', dbPath: f.dbPath });
    try {
      assert.equal((await other.build()).memberCount, 1);
    } finally {
      await other.close();
    }
    assert.equal(engine.status().memberCount, 3);
  } finally {
    await engine?.close();
    f.close();
  }
});

test('incremental clustering replaces whole components, handles deleted isolates and matches full results', async () => {
  const f = await fixture();
  try {
    for (let group = 0; group < 10; group++) {
      f.write(`g${group}/a.ts`, "import './b'; export const a=1;");
      f.write(`g${group}/b.ts`, 'export const b=2;');
    }
    f.write('isolate.ts', 'export const alone=1;');
    await f.indexer.index(f.source);
    await buildGraph(f.store);
    f.arachne.db
      .prepare(
        "UPDATE arachne_files SET language='js' WHERE project=? AND agent=? AND path='g0/a.ts'",
      )
      .run(f.scope.project, f.scope.agent);
    assert.equal(readBuildPlan(f.store, false).strategy, 'incremental');
    const incremental = await buildGraph(f.store);
    assert.equal(incremental.strategy, 'incremental');
    const members = rows(f, 'verdandi_members');
    const full = await buildGraph(f.store, { force: true });
    assert.deepEqual(rows(f, 'verdandi_members'), members);
    assert.equal(full.modularity, incremental.modularity);
    f.arachne.removeFile('isolate.ts');
    assert.equal((await buildGraph(f.store)).strategy, 'incremental');
    assert.equal(rows(f, 'verdandi_members').length, 20);
    f.store.connection.execute('INSERT INTO verdandi_semantic_edges VALUES(?,?,?,?,?,?,?,?)', [
      f.scope.project,
      f.scope.agent,
      'g0/a.ts',
      'g1/a.ts',
      0.8,
      'semantic',
      'test',
      123,
    ]);
    assert.equal((await buildGraph(f.store)).strategy, 'full');
  } finally {
    f.close();
  }
});

test('source changes during asynchronous computation are retried before publication', async () => {
  const f = await fixture();
  try {
    f.write('a.ts', 'export const a=1;');
    await f.indexer.index(f.source);
    const pending = buildGraph(f.store);
    f.arachne.upsertFile('new.ts', 'new', 'ts', 1, '2026-01-01');
    const result = await pending;
    assert.equal(result.attempts, 2);
    assert.equal(result.memberCount, 2);
    assert.equal(
      rows(f, 'verdandi_members').some((row) => row.path === 'new.ts'),
      true,
    );
  } finally {
    f.close();
  }
});

test('mid-publication SQL failure rolls back graph, fingerprints and dirty acknowledgement', async () => {
  const f = await fixture();
  try {
    f.write('a.ts', 'export const a=1;');
    await f.indexer.index(f.source);
    await buildGraph(f.store);
    const before = [
      'verdandi_communities',
      'verdandi_members',
      'verdandi_build_state',
      'verdandi_node_state',
    ].map((table) => rows(f, table));
    f.arachne.upsertFile('new.ts', 'new', 'ts', 1, '2026-01-01');
    f.store.connection.execute(
      'INSERT INTO verdandi_dirty(project,agent,path,reason) VALUES(?,?,?,?)',
      [f.scope.project, f.scope.agent, 'new.ts', 'test'],
    );
    f.store.connection.execute(`CREATE TRIGGER test_fail BEFORE INSERT ON verdandi_members
      WHEN NEW.path='new.ts' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END`);
    await assert.rejects(buildGraph(f.store), /injected publication failure/);
    assert.deepEqual(
      [
        'verdandi_communities',
        'verdandi_members',
        'verdandi_build_state',
        'verdandi_node_state',
      ].map((table) => rows(f, table)),
      before,
    );
    assert.equal(rows(f, 'verdandi_dirty').length, 1);
    assert.equal(rows(f, 'verdandi_jobs').length, 0);
    f.store.connection.execute('DROP TRIGGER test_fail');
    assert.equal((await buildGraph(f.store)).memberCount, 2);
  } finally {
    f.close();
  }
});

test('shutdown cancels active workers, clears leases, preserves old graph and permits reopening', async () => {
  const f = await fixture();
  let engine;
  try {
    f.write('a.ts', 'export const a=1;');
    await f.indexer.index(f.source);
    await buildGraph(f.store);
    const before = rows(f, 'verdandi_members');
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    const pending = engine.build({ force: true });
    const rejected = assert.rejects(pending, /closing/);
    assert.equal(engine.status().memberCount, 1);
    await engine.close();
    await rejected;
    assert.deepEqual(rows(f, 'verdandi_members'), before);
    assert.equal(rows(f, 'verdandi_jobs').length, 0);
    await assert.rejects(engine.build(), /closed/);
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    assert.equal((await engine.build()).strategy, 'no_changes');
  } finally {
    await engine?.close();
    f.close();
  }
});

test('empty graphs clear all previous members and preserve valid empty state on retry', async () => {
  const f = await fixture();
  try {
    f.arachne.upsertFile('a.ts', 'a', 'ts', 1, '2026-01-01');
    await buildGraph(f.store);
    f.arachne.removeFile('a.ts');
    const empty = await buildGraph(f.store);
    assert.equal(empty.memberCount, 0);
    assert.equal(empty.communityCount, 0);
    assert.equal(empty.modularity, 0);
    assert.equal((await buildGraph(f.store)).strategy, 'no_changes');
  } finally {
    f.close();
  }
});
