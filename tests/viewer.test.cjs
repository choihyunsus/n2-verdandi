// Browser-independent regressions cover safe labels, literal paths and asynchronous navigation ordering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function viewer() {
  const elements = new Map();
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    AbortController,
    window: { addEventListener() {} },
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', setAttribute() {} });
        return elements.get(id);
      },
    },
  });
  for (const name of ['graph-ui.js', 'graph-render.js', 'graph.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../static', name), 'utf8');
    vm.runInContext(source.replace(/\ninit\(\);\s*$/, '\n'), context, { filename: name });
  }
  return { context, elements };
}

test('duplicate basenames get distinguishable labels and literal paths are encoded exactly once', () => {
  const { context } = viewer();
  const labels = context.graphLabels([
    { id: 'source/engine/index.ts' },
    { id: 'tests/engine/index.ts' },
    { id: 'memory/index.ts' },
    { id: 'unique.ts' },
  ]);
  assert.equal(labels.get('source/engine/index.ts'), 'source/engine/index.ts');
  assert.equal(labels.get('tests/engine/index.ts'), 'tests/engine/index.ts');
  assert.equal(labels.get('memory/index.ts'), 'memory/index.ts');
  assert.equal(labels.get('unique.ts'), 'unique.ts');
  const filename = "한글 %2F'/source.ts";
  assert.equal(
    context.graphUrl(2, filename),
    `/api/verdandi/graph/node/${encodeURIComponent(filename)}`,
  );
  assert.equal(context.langColor('__proto__'), '#8b949e');
  assert.equal(context.langColor('constructor'), '#8b949e');
  assert.doesNotMatch(
    context.buildTooltip({ id: '<img src=x onerror=alert(1)>', language: '__proto__' }),
    /<img/,
  );
});

test('viewer rejects invalid graphs before touching the drawing', () => {
  const { context } = viewer();
  const base = {
    level: 0,
    nodes: [{ id: 'a', type: 'community', language: 'ts', size: 1 }],
    edges: [],
  };
  assert.doesNotThrow(() => context.validateGraph(base));
  assert.throws(
    () => context.validateGraph({ ...base, nodes: [base.nodes[0], base.nodes[0]] }),
    /node/,
  );
  assert.throws(
    () =>
      context.validateGraph({
        ...base,
        edges: [{ source: 'a', target: 'missing', type: 'import' }],
      }),
    /edge/,
  );
  assert.throws(
    () =>
      context.validateGraph({
        ...base,
        edges: [{ source: 'a', target: 'a', type: 'semantic', similarity: 2 }],
      }),
    /edge/,
  );
  assert.throws(
    () => context.validateGraph({ ...base, nodes: Array(20001).fill(base.nodes[0]) }),
    /oversized/,
  );
});

test('late navigation cannot replace a newer graph and failed requests preserve the current view', async () => {
  const { context, elements } = viewer();
  const pending = [],
    drawn = [];
  context.fetch = (url) => new Promise((resolve) => pending.push({ url, resolve }));
  context.render = (data) => drawn.push(data.level);
  context.updateBreadcrumb = () => {};
  const first = context.loadLevel(1, 'old.ts');
  const second = context.loadLevel(2, 'new.ts');
  const response = (level) => ({ ok: true, json: async () => ({ level, nodes: [], edges: [] }) });
  pending[1].resolve(response(2));
  await second;
  pending[0].resolve(response(1));
  await first;
  assert.deepEqual(drawn, [2]);
  assert.equal(vm.runInContext('currentNodeId', context), 'new.ts');
  const failed = context.loadLevel(1, 'broken.ts');
  pending[2].resolve({ ok: false, status: 500 });
  await failed;
  assert.deepEqual(drawn, [2]);
  assert.equal(vm.runInContext('currentLevel', context), 2);
  assert.match(elements.get('stats').textContent, /HTTP 500/);
  assert.equal(elements.get('loading').style.display, 'none');
});
