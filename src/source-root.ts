// Bind document provenance to one canonical source root for each project and agent.
import path from 'node:path';
import type { GraphStore } from './store';
import { text } from 'n2-arachne/dist/lib/store-values.js';

export function bindSourceRoot(store: GraphStore): void {
  if (!store.projectRoot) return;
  store.connection.transaction(() => {
    const existing = store.connection.query<{ root: unknown }>(
      'SELECT root FROM verdandi_roots WHERE project=? AND agent=?',
      [store.project, store.agent],
    )[0];
    if (existing) requireSameRoot(text(existing.root, 'source root'), store.projectRoot!);
    const arachne = store.connection.query<{ value: unknown }>(
      "SELECT value FROM meta WHERE key='arachne_schema_version'",
    )[0];
    if (arachne) {
      if (arachne.value !== '1') throw new Error('Unsupported Arachne source schema');
      const owner = store.connection.query<{ root: unknown }>(
        'SELECT root FROM arachne_scope_state WHERE project=? AND agent=?',
        [store.project, store.agent],
      )[0];
      if (owner) requireSameRoot(text(owner.root, 'indexed source root'), store.projectRoot!);
    }
    store.connection.execute('INSERT OR IGNORE INTO verdandi_roots VALUES(?,?,?)', [
      store.project,
      store.agent,
      store.projectRoot!,
    ]);
  });
}

function requireSameRoot(stored: string, requested: string): void {
  const normalize = (value: string): string =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(stored) !== normalize(requested))
    throw new Error('This project and agent already refer to a different source root');
}
