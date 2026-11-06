// Deterministic vector fixtures exercise the public engine without an external model service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Verdandi } = require('../dist/library');
const { buildSemantic } = require('../dist/semantic');
const { readSemanticSnapshot } = require('../dist/semantic-vectors');
const { readSemanticEdges } = require('../dist/semantic-plan');
const { embeddingSourceHash } = require('n2-arachne/dist/lib/vector-store.js');
const { encodeVector } = require('n2-arachne/dist/lib/vectors.js');
const { fixture } = require('./helpers.cjs');

function seed(store, total, model = 'fixture-model') {
  store.db.transaction(() => {
    for (let index = 0; index < total; index++) {
      const filename = `f${String(index).padStart(3, '0')}.ts`;
      const result = store.upsertFile(filename, 'fixture', 'ts', 10, '2026-01-01');
      if (!store.getChunksByFileId(result.fileId).length)
        store.insertChunks(result.fileId, [
          {
            type: 'code',
            name: null,
            startLine: 1,
            endLine: 1,
            content: `export const file${index}=1;`,
            tokenCount: 8,
            searchText: filename,
          },
        ]);
      const chunk = store.getChunksByFileId(result.fileId)[0];
      store.db
        .prepare(
          `INSERT OR IGNORE INTO arachne_embeddings(chunk_id,model,dimensions,vector,source_hash)
        VALUES(?,?,?,?,?)`,
        )
        .run(chunk.id, model, 16, encodeVector(Array(16).fill(1)), embeddingSourceHash(chunk));
    }
  })();
}

function comparable(store) {
  return readSemanticEdges(store).map(({ computedAt, ...edge }) => edge);
}

test('public semantic computation shares scoped portable Arachne vectors and clears zero/one-vector graphs', async () => {
  const f = await fixture();
  let engine;
  try {
    seed(f.arachne, 3);
    seed(f.other, 4, 'foreign-model');
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    const result = await engine.semantic();
    assert.equal(result.filesWithVectors, 3);
    assert.equal(result.edgesStored, 3);
    assert.equal(result.excludedFiles, 0);
    const edges = readSemanticEdges(f.store);
    assert.equal(
      edges.every((edge) => edge.model === 'fixture-model'),
      true,
    );
    assert.equal(
      edges.every((edge) => Math.abs(edge.computedAt - Math.floor(Date.now() / 1000)) < 10),
      true,
    );
    await engine.close();
    engine = new Verdandi({ ...f.scope, dbPath: f.dbPath });
    assert.equal((await engine.semantic()).pairsCompared, 0);
    assert.deepEqual(readSemanticEdges(f.store), edges);
    f.arachne.db
      .prepare(
        `DELETE FROM arachne_embeddings WHERE chunk_id IN
      (SELECT c.id FROM arachne_chunks c JOIN arachne_files f ON f.id=c.file_id
      WHERE f.project=? AND f.agent=? AND f.path!='f000.ts')`,
      )
      .run(f.scope.project, f.scope.agent);
    const one = await engine.semantic();
    assert.equal(one.filesWithVectors, 1);
    assert.equal(one.edgesStored, 0);
    f.arachne.db
      .prepare(
        `DELETE FROM arachne_embeddings WHERE chunk_id IN
      (SELECT c.id FROM arachne_chunks c JOIN arachne_files f ON f.id=c.file_id WHERE f.project=? AND f.agent=?)`,
      )
      .run(f.scope.project, f.scope.agent);
    const zero = await engine.semantic();
    assert.equal(zero.filesWithVectors, 0);
    assert.equal(zero.edgesStored, 0);
    assert.equal(zero.model, null);
  } finally {
    await engine?.close();
    f.close();
  }
});

test('stale, nonfinite, zero and dimension-corrupt chunks exclude their complete files', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 6);
    const ids = f.arachne.db
      .prepare(`SELECT e.chunk_id FROM arachne_embeddings e ORDER BY e.chunk_id`)
      .all()
      .map((row) => row.chunk_id);
    f.arachne.db
      .prepare('UPDATE arachne_embeddings SET source_hash=? WHERE chunk_id=?')
      .run('stale', ids[0]);
    const nan = Buffer.alloc(64);
    nan.writeFloatLE(NaN, 0);
    f.arachne.db
      .prepare('UPDATE arachne_embeddings SET vector=? WHERE chunk_id=?')
      .run(nan, ids[1]);
    f.arachne.db
      .prepare('UPDATE arachne_embeddings SET vector=zeroblob(64) WHERE chunk_id=?')
      .run(ids[2]);
    f.arachne.db.pragma('ignore_check_constraints=ON');
    try {
      f.arachne.db
        .prepare('UPDATE arachne_embeddings SET dimensions=999999 WHERE chunk_id=?')
        .run(ids[3]);
    } finally {
      f.arachne.db.pragma('ignore_check_constraints=OFF');
    }
    const result = await buildSemantic(f.store);
    assert.equal(result.filesWithVectors, 2);
    assert.equal(result.excludedFiles, 4);
    assert.equal(result.invalidChunks, 4);
    assert.equal(result.edgesStored, 1);
    f.arachne.db
      .prepare("UPDATE arachne_chunks SET content='different source' WHERE id=?")
      .run(ids[4]);
    assert.equal((await buildSemantic(f.store)).edgesStored, 0);
    assert.equal(readSemanticSnapshot(f.store).excludedFiles, 5);
  } finally {
    f.close();
  }
});

test('model ambiguity requires a choice and same-model mixed dimensions never cross spaces', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 4);
    await buildSemantic(f.store);
    const before = readSemanticEdges(f.store);
    seed(f.arachne, 4, 'other-model');
    await assert.rejects(buildSemantic(f.store), /Multiple embedding models/);
    assert.deepEqual(readSemanticEdges(f.store), before);
    assert.equal((await buildSemantic(f.store, { model: 'other-model' })).edgesStored, 6);
    const id = f.arachne.getChunksByFileId(f.arachne.getFileByPath('f000.ts').id)[0].id;
    f.arachne.db
      .prepare('UPDATE arachne_embeddings SET dimensions=2,vector=? WHERE model=? AND chunk_id=?')
      .run(encodeVector([1, 1]), 'other-model', id);
    assert.equal((await buildSemantic(f.store, { model: 'other-model' })).edgesStored, 3);
    await assert.rejects(buildSemantic(f.store, { model: 'missing-model' }), /no vectors/);
  } finally {
    f.close();
  }
});

test('incremental vector reconciliation detects deletion, matches full selection and preserves timestamps', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 16);
    await buildSemantic(f.store);
    const first = readSemanticEdges(f.store);
    f.arachne.removeFile('f001.ts');
    const result = await buildSemantic(f.store);
    assert.equal(result.strategy, 'incremental');
    assert.equal(result.edgesStored, 105);
    const actual = readSemanticEdges(f.store);
    assert.deepEqual(
      actual,
      first.filter((edge) => edge.source !== 'f001.ts' && edge.target !== 'f001.ts'),
    );
    const incremental = comparable(f.store);
    await buildSemantic(f.store, { force: true });
    assert.deepEqual(comparable(f.store), incremental);
  } finally {
    f.close();
  }
});

test('saturated semantic top-K is recomputed deterministically after adding vectors', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 150);
    assert.equal((await buildSemantic(f.store)).edgesStored, 10000);
    seed(f.arachne, 153);
    const result = await buildSemantic(f.store);
    assert.equal(result.edgesStored, 10000);
    assert.equal(result.strategy, 'full');
    const expected = [];
    for (let a = 0; a < 153; a++)
      for (let b = a + 1; b < 153; b++)
        expected.push([`f${String(a).padStart(3, '0')}.ts`, `f${String(b).padStart(3, '0')}.ts`]);
    assert.deepEqual(
      comparable(f.store).map((edge) => [edge.source, edge.target]),
      expected.slice(0, 10000),
    );
    const before = comparable(f.store);
    await buildSemantic(f.store, { force: true });
    assert.deepEqual(comparable(f.store), before);
  } finally {
    f.close();
  }
});

test('external semantic edits invalidate the cached selection and vector races retry safely', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 6);
    await buildSemantic(f.store);
    f.store.connection.execute("DELETE FROM verdandi_semantic_edges WHERE source_path='f000.ts'");
    assert.equal((await buildSemantic(f.store)).strategy, 'full');
    assert.equal(readSemanticEdges(f.store).length, 15);
    const pending = buildSemantic(f.store, { force: true });
    const id = f.arachne.getChunksByFileId(f.arachne.getFileByPath('f000.ts').id)[0].id;
    f.arachne.db
      .prepare('UPDATE arachne_embeddings SET vector=? WHERE chunk_id=?')
      .run(encodeVector([1, -1, ...Array(14).fill(0)]), id);
    const result = await pending;
    assert.equal(result.attempts, 2);
    assert.equal(result.edgesStored, 10);
  } finally {
    f.close();
  }
});

test('semantic publication failure preserves previous links, state and dirty records', async () => {
  const f = await fixture();
  try {
    seed(f.arachne, 4);
    await buildSemantic(f.store);
    const before = readSemanticEdges(f.store);
    const dirty = f.store.connection.query('SELECT * FROM verdandi_dirty ORDER BY path');
    const state = f.store.connection.query('SELECT * FROM verdandi_semantic_state ORDER BY path');
    seed(f.arachne, 5);
    f.store.connection.execute(
      "CREATE TRIGGER test_fail_semantic BEFORE INSERT ON verdandi_semantic_edges BEGIN SELECT RAISE(ABORT,'injected semantic failure'); END",
    );
    await assert.rejects(buildSemantic(f.store), /injected semantic failure/);
    assert.deepEqual(readSemanticEdges(f.store), before);
    assert.deepEqual(f.store.connection.query('SELECT * FROM verdandi_dirty ORDER BY path'), dirty);
    assert.deepEqual(
      f.store.connection.query('SELECT * FROM verdandi_semantic_state ORDER BY path'),
      state,
    );
    f.store.connection.execute('DROP TRIGGER test_fail_semantic');
    assert.equal((await buildSemantic(f.store)).edgesStored, 10);
  } finally {
    f.close();
  }
});
