// Check worker cancellation, durable fencing and resource guards independently of publication.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acquireLease, assertLease, releaseLease } = require('../dist/job-lease');
const { computeClusters } = require('../dist/compute');
const { boundedRows, validateGraphBudget } = require('../dist/graph-budget');
const { fixture } = require('./helpers.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('leases exclude same-scope jobs and a replaced lease cannot publish or delete its successor', async () => {
  const f = await fixture();
  try {
    const first = acquireLease(f.store, 'graph');
    assert.throws(() => acquireLease(f.store, 'graph'), /already running/);
    const semantic = acquireLease(f.store, 'semantic');
    assertLease(f.store, semantic);
    f.store.connection.execute("UPDATE verdandi_jobs SET expires_at=0 WHERE kind='graph'");
    const next = acquireLease(f.store, 'graph');
    assert.notEqual(next.id, first.id);
    assert.throws(() => assertLease(f.store, first), /replaced/);
    releaseLease(f.store, first);
    assertLease(f.store, next);
    releaseLease(f.store, next);
    releaseLease(f.store, semantic);
    assert.equal(f.store.connection.query('SELECT * FROM verdandi_jobs').length, 0);
  } finally {
    f.close();
  }
});

test('CPU worker remains cancellable and reports input errors', async () => {
  const controller = new AbortController();
  const graph = { nodes: [{ path: 'a.ts', language: 'ts' }], edges: [] };
  const pending = computeClusters(graph, 0, controller.signal);
  const rejected = assert.rejects(pending, /cancel fixture/);
  setImmediate(() => controller.abort(new Error('cancel fixture')));
  await rejected;
  await assert.rejects(computeClusters(graph, 0, controller.signal), /cancel fixture/);
  await assert.rejects(
    computeClusters({ ...graph, edges: [{ source: 'a.ts', target: 'missing.ts' }] }, 1),
    /Dangling/,
  );
  assert.equal((await computeClusters(graph, 0)).communities.length, 1);
});

test('text budgets fail before fetching large row contents or cloning large graph paths', async () => {
  const f = await fixture();
  try {
    assert.throws(
      () =>
        boundedRows(f.store.connection, "SELECT '12345' AS path", [], 1, ['path'], {
          remaining: 4,
        }),
      /input budget/,
    );
    assert.throws(
      () =>
        boundedRows(f.store.connection, "SELECT 'a' AS path UNION ALL SELECT 'b'", [], 1, ['path']),
      /rows/,
    );
    const graph = { nodes: [{ path: 'a'.repeat(4096), language: 'ts' }], edges: [] };
    graph.edges = Array.from({ length: 4100 }, () => ({
      source: graph.nodes[0].path,
      target: graph.nodes[0].path,
    }));
    assert.throws(() => validateGraphBudget(graph), /input budget/);
  } finally {
    f.close();
  }
});

test('a lease left by an exited process is recovered before its expiry', async () => {
  const f = await fixture();
  try {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const {GraphStore}=require('./dist/store');
      const {acquireLease}=require('./dist/job-lease');
      const store=new GraphStore({dbPath:process.argv[1],project:'fixture',agent:'worker'});
      acquireLease(store,'graph'); store.close();
    `,
        f.dbPath,
      ],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(child.status, 0, child.stderr);
    const abandoned = f.store.connection.query("SELECT * FROM verdandi_jobs WHERE kind='graph'")[0];
    assert.ok(abandoned.expires_at > Date.now());
    const recovered = acquireLease(f.store, 'graph');
    assert.notEqual(recovered.id, abandoned.lease_id);
    releaseLease(f.store, recovered);
  } finally {
    f.close();
  }
});
