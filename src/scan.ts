// Reuse Arachne's indexer for the standalone scan-and-build workflow without duplicating parsing.
import path from 'node:path';
import { Store, Indexer } from 'n2-arachne';
import type { ArachneConfig } from 'n2-arachne/dist/types.js';
import type { GraphStore } from './store';
import { buildGraph, type BuildOptions } from './builder';
import { bindSourceRoot } from './source-root';

export async function scanAndBuild(store: GraphStore, options: BuildOptions = {}) {
  if (options.force !== undefined && typeof options.force !== 'boolean')
    throw new Error('force must be a boolean');
  options.signal?.throwIfAborted();
  if (!store.projectRoot || store.dbPath === ':memory:')
    throw new Error('Scanning requires projectRoot and a persistent shared database');
  bindSourceRoot(store);
  const source = new Store(path.dirname(store.dbPath), {
    dbPath: store.dbPath,
    project: store.project,
    agent: store.agent,
    projectRoot: store.projectRoot,
    importLegacy: false,
  });
  try {
    await source.init();
    const config = structuredClone(require('n2-arachne/config.default.js')) as ArachneConfig;
    config.indexing.maxFiles = 20000;
    const indexer = new Indexer(source, config);
    const indexed = await indexer.index(store.projectRoot, {
      force: options.force,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();
    return { index: indexed, graph: indexed.complete ? await buildGraph(store, options) : null };
  } finally {
    source.close();
  }
}
