// Isolated source and shared storage fixtures for cross-module contracts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, Indexer } = require('n2-arachne');
const { GraphStore } = require('../dist/store');

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verdandi-fixture-'));
  const source = path.join(root, 'source'),
    dbPath = path.join(root, 'data', 'mimir.db');
  fs.mkdirSync(source);
  const scope = { project: 'fixture', agent: 'worker' };
  const arachne = new Store(path.join(root, 'data'), { ...scope, dbPath, projectRoot: source });
  const other = new Store(path.join(root, 'data'), {
    project: 'fixture',
    agent: 'other',
    dbPath,
    projectRoot: source,
  });
  await arachne.init();
  await other.init();
  const store = new GraphStore({ ...scope, dbPath, projectRoot: source });
  const config = structuredClone(require('n2-arachne/config.default.js'));
  const indexer = new Indexer(arachne, config);
  return {
    root,
    source,
    dbPath,
    scope,
    store,
    arachne,
    other,
    indexer,
    write(filename, content) {
      fs.mkdirSync(path.dirname(path.join(source, filename)), { recursive: true });
      fs.writeFileSync(path.join(source, filename), content);
    },
    close() {
      store.close();
      arachne.close();
      other.close();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
module.exports = { fixture };
