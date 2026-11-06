const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readGraphSnapshot, inputRevision } = require('../dist/graph-input');
const { fixture } = require('./helpers.cjs');

test('actual Arachne inputs are owner-filtered and imports/semantic edges are deduplicated', async () => {
  const f = await fixture();
  try {
    f.write('a.ts', "import './b'; export const alpha=1;");
    f.write('b.ts', 'export const beta=2;');
    f.write('notes.md', '# excluded document');
    assert.equal((await f.indexer.index(f.source)).complete, true);
    f.other.upsertFile('foreign.ts', 'hash', 'ts', 1, '2026-01-01');
    const sql = f.store.connection;
    sql.execute(
      "INSERT INTO verdandi_semantic_edges VALUES('fixture','worker','b.ts','a.ts',0.9,'semantic','fixture',123)",
    );
    sql.execute(
      "INSERT INTO verdandi_semantic_edges VALUES('fixture','other','foreign.ts','a.ts',0.9,'semantic','fixture',123)",
    );
    const snapshot = readGraphSnapshot(f.store);
    assert.deepEqual(
      snapshot.graph.nodes.map((node) => node.path),
      ['a.ts', 'b.ts'],
    );
    assert.deepEqual(snapshot.graph.edges, [{ source: 'a.ts', target: 'b.ts' }]);
    assert.equal(snapshot.coverage, 'complete');
    const before = snapshot.revision;
    f.arachne.db
      .prepare(
        "UPDATE arachne_files SET hash='changed' WHERE project='fixture' AND agent='worker' AND path='a.ts'",
      )
      .run();
    assert.notEqual(inputRevision(f.store), before);
    assert.equal(readGraphSnapshot(f.store).topologyHash, snapshot.topologyHash);
    f.arachne._setMeta('last_scan_complete', 'false');
    assert.equal(readGraphSnapshot(f.store).coverage, 'partial');
  } finally {
    f.close();
  }
});

test('semantic edits and Skuld-style deletion invalidate only their owning graph inputs', async () => {
  const f = await fixture();
  try {
    f.write('a.ts', 'const a=1;');
    f.write('b.ts', 'const b=2;');
    await f.indexer.index(f.source);
    const sql = f.store.connection,
      first = inputRevision(f.store);
    sql.execute(
      "INSERT INTO verdandi_semantic_edges VALUES('fixture','worker','a.ts','b.ts',0.9,'semantic','fixture',123)",
    );
    const inserted = inputRevision(f.store);
    assert.notEqual(inserted, first);
    assert.equal(readGraphSnapshot(f.store).graph.edges.length, 1);
    assert.equal(
      sql.query(
        "SELECT count(*) n FROM verdandi_dirty WHERE project='fixture' AND agent='worker'",
      )[0].n,
      2,
    );
    sql.execute(
      "UPDATE verdandi_semantic_edges SET computed_at=124 WHERE project='fixture' AND agent='worker'",
    );
    assert.notEqual(inputRevision(f.store), inserted);
    sql.execute("DELETE FROM verdandi_semantic_edges WHERE project='fixture' AND agent='worker'");
    assert.equal(readGraphSnapshot(f.store).graph.edges.length, 0);
    const own = inputRevision(f.store);
    sql.execute(
      "INSERT INTO verdandi_semantic_edges VALUES('unrelated','other','a.ts','b.ts',0.9,'semantic','fixture',123)",
    );
    assert.equal(inputRevision(f.store), own);
  } finally {
    f.close();
  }
});

test('stored type corruption and invalid coverage fail explicitly', async () => {
  const f = await fixture();
  try {
    f.write('a.ts', 'const a=1;');
    await f.indexer.index(f.source);
    f.arachne.db
      .prepare(
        "UPDATE arachne_files SET language=zeroblob(1) WHERE project='fixture' AND agent='worker'",
      )
      .run();
    assert.throws(() => readGraphSnapshot(f.store), /language/);
    f.arachne.db
      .prepare("UPDATE arachne_files SET language='ts' WHERE project='fixture' AND agent='worker'")
      .run();
    f.arachne._setMeta('last_scan_complete', 'corrupt');
    assert.throws(() => readGraphSnapshot(f.store), /coverage/);
  } finally {
    f.close();
  }
});

test('dependency-only updates advance the owning input revision without unrelated owner noise', async () => {
  const f = await fixture();
  try {
    const a = f.arachne.upsertFile('a.ts', 'a', 'ts', 1, '2026-01-01');
    const b = f.arachne.upsertFile('b.ts', 'b', 'ts', 1, '2026-01-01');
    const before = inputRevision(f.store);
    f.arachne.insertDependencies(a.fileId, [
      { targetPath: './b', targetFileId: b.fileId, depType: 'import' },
    ]);
    const added = inputRevision(f.store);
    assert.notEqual(added, before);
    f.arachne.clearDependencies(a.fileId);
    assert.notEqual(inputRevision(f.store), added);
    const current = inputRevision(f.store);
    const foreign = f.other.upsertFile('foreign.ts', 'other', 'ts', 1, '2026-01-01');
    f.other.insertDependencies(foreign.fileId, [
      { targetPath: './unknown', targetFileId: null, depType: 'import' },
    ]);
    assert.equal(inputRevision(f.store), current);
  } finally {
    f.close();
  }
});
