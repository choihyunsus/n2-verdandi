// Execute the installed-style CLI, real stdio MCP transport and loopback HTTP routes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { Verdandi, startGraphViewer } = require('../dist/library');
const { parseCli } = require('../dist/cli-options');
const { fixture } = require('./helpers.cjs');

const entry = path.resolve(__dirname, '../dist/index.js');
function argumentsFor(f) {
  return [
    '--db',
    f.dbPath,
    '--project',
    f.scope.project,
    '--agent',
    f.scope.agent,
    '--root',
    f.source,
  ];
}
function run(args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  return result;
}

test('CLI scan, build, read and learning work through persisted common storage', async () => {
  const f = await fixture();
  try {
    assert.match(run(['--help']).stdout, /scan/);
    assert.equal(run(['--version']).stdout.trim(), '1.0.0');
    f.write('a.ts', "import './b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    f.write('--notes.txt', 'Standalone document content.');
    f.write('--help', 'Literal option-named document.');
    const options = argumentsFor(f);
    const scan = run([...options, 'scan']);
    assert.equal(scan.status, 0, scan.stderr);
    const scanned = JSON.parse(scan.stdout);
    assert.equal(scanned.index.complete, true);
    assert.equal(scanned.graph.nodeCount, 2);
    assert.equal(JSON.parse(run([...options, 'status']).stdout).stale, false);
    assert.equal(JSON.parse(run([...options, 'build']).stdout).strategy, 'no_changes');
    const list = JSON.parse(run([...options, 'list', '--limit', '1']).stdout);
    assert.equal(list.items.length, 1);
    assert.equal(JSON.parse(run([...options, 'community', list.items[0].id]).stdout).size, 2);
    assert.equal(
      JSON.parse(run([...options, 'graph', '--level', '2', 'a.ts']).stdout).center,
      'a.ts',
    );
    assert.equal(
      JSON.parse(run([...options, 'backlinks', 'b.ts']).stdout).importBacklinks[0].path,
      'a.ts',
    );
    assert.equal(JSON.parse(run([...options, 'semantic']).stdout).filesWithVectors, 0);
    assert.equal(
      JSON.parse(run([...options, 'learn', '--', '--notes.txt']).stdout).status,
      'learned',
    );
    assert.equal(
      JSON.parse(run([...options, 'learn', '--', '--notes.txt']).stdout).status,
      'already_learned',
    );
    assert.equal(JSON.parse(run([...options, 'learn', '--', '--help']).stdout).status, 'learned');
    const failed = run([...options, 'community', 'missing.ts']);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /not found/);
  } finally {
    f.close();
  }
});

test('CLI rejects unknown, duplicate, incompatible and malformed options', () => {
  const base = ['--db', 'fixture.db', '--project', 'fixture', '--agent', 'worker'];
  for (const tail of [
    ['status', '--force'],
    ['list', '--limit', '0'],
    ['graph', '--level', '3'],
    ['status', '--db', 'another.db'],
    ['scan', '--unknown'],
    ['learn'],
    ['status', 'extra'],
    ['serve', '--port', 'NaN'],
    ['list', '--offset', '-1'],
  ])
    assert.throws(() => parseCli([...base, ...tail]));
  assert.throws(() => parseCli(['status']), /required/);
  assert.equal(run(['status']).status, 1);
});

test('real stdio MCP lists all tools, performs scan/build/read/learn and exits with clean leases', async () => {
  const f = await fixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, ...argumentsFor(f), 'mcp'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'verdandi-fixture', version: '1.0.0' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  try {
    f.write('a.ts', "import './b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    f.write('notes.md', '# Fixture\nUnverified source document.');
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 9);
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    assert.equal((await call('verdandi_scan')).graph.nodeCount, 2);
    assert.equal((await call('verdandi_status')).indexed, true);
    assert.equal((await call('verdandi_build')).strategy, 'no_changes');
    assert.equal((await call('verdandi_semantic')).edgesStored, 0);
    const groups = await call('verdandi_list');
    assert.equal((await call('verdandi_read', { id: groups.items[0].id })).size, 2);
    assert.equal((await call('verdandi_graph', { level: 2, id: 'a.ts' })).center, 'a.ts');
    assert.equal(
      (await call('verdandi_backlinks', { path: 'b.ts' })).importBacklinks[0].path,
      'a.ts',
    );
    assert.equal((await call('verdandi_learn_doc', { path: 'notes.md' })).verified, false);
    assert.equal(
      (await client.callTool({ name: 'verdandi_graph', arguments: { level: 2, id: '../escape' } }))
        .isError,
      true,
    );
    assert.equal(
      (await client.callTool({ name: 'verdandi_read', arguments: { id: 'missing' } })).isError,
      true,
    );
  } finally {
    await client.close();
    await transport.close();
    assert.equal(f.store.connection.query('SELECT * FROM verdandi_jobs').length, 0, stderr);
    f.close();
  }
});

test('HTTP routes retain exact percent paths and return explicit status, missing and corruption errors', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath, projectRoot: f.source });
  let viewer;
  try {
    f.write("한글 %2F'/a.ts", "import '../b'; export const a=1;");
    f.write('b.ts', 'export const b=2;');
    await client.scan();
    viewer = await startGraphViewer(client);
    const origin = new URL(viewer.url).origin;
    const html = await fetch(viewer.url);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await html.text(), /graph-render.js/);
    for (const file of ['graph.js', 'graph-ui.js', 'graph-render.js', 'd3.v7.min.js', 'LICENSE-D3'])
      assert.equal((await fetch(`${origin}/verdandi/${file}`)).status, 200);
    assert.equal((await fetch(`${origin}/api/verdandi/graph/overview`)).status, 200);
    const node = await fetch(
      `${origin}/api/verdandi/graph/node/${encodeURIComponent("한글 %2F'/a.ts")}`,
    );
    assert.equal(node.status, 200);
    assert.equal((await node.json()).center, "한글 %2F'/a.ts");
    assert.equal((await fetch(`${origin}/api/verdandi/graph/node/missing`)).status, 404);
    assert.equal((await fetch(`${origin}/api/verdandi/graph/node/%ZZ`)).status, 400);
    assert.equal((await fetch(viewer.url, { method: 'POST' })).status, 405);
    assert.equal(
      (await fetch(viewer.url, { headers: { Origin: 'https://unrelated.invalid' } })).status,
      403,
    );
    const wrongHost = await new Promise((resolve, reject) => {
      const request = http.get(
        viewer.url,
        { headers: { Host: 'unrelated.invalid' } },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        },
      );
      request.once('error', reject);
    });
    assert.equal(wrongHost, 403);
    f.arachne._setMeta('last_scan_complete', 'broken');
    const broken = await fetch(`${origin}/api/verdandi/graph/stats`);
    assert.equal(broken.status, 500);
    assert.match((await broken.json()).error, /coverage/);
  } finally {
    await viewer?.close();
    await client.close();
    f.close();
  }
});

test('incomplete scans report issues and retain the last published graph', async () => {
  const f = await fixture(),
    client = new Verdandi({ ...f.scope, dbPath: f.dbPath, projectRoot: f.source });
  try {
    f.write('a.ts', 'export const a=1;');
    await client.scan();
    const before = client.communities();
    f.write('bad.docx', 'broken document');
    const partial = await client.scan();
    assert.equal(partial.index.complete, false);
    assert.equal(partial.graph, null);
    assert.deepEqual(client.communities().items, before.items);
    assert.equal(client.status().coverage, 'partial');
  } finally {
    await client.close();
    f.close();
  }
});
