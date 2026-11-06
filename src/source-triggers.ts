// Track dependency and vector changes that Arachne's file/chunk revision does not cover.
import type { SqlConnection } from './storage-types';

export function initializeSourceTriggers(connection: SqlConnection): void {
  for (const operation of ['INSERT', 'DELETE', 'UPDATE']) {
    const aliases =
      operation === 'UPDATE' ? ['old', 'new'] : [operation === 'INSERT' ? 'new' : 'old'];
    for (const kind of ['dependency', 'vector']) {
      const table = kind === 'dependency' ? 'arachne_dependencies' : 'arachne_embeddings';
      const owners = aliases.map((alias) =>
        kind === 'dependency'
          ? `SELECT project,agent FROM arachne_files WHERE id=${alias}.source_file_id`
          : `SELECT f.project,f.agent FROM arachne_chunks c JOIN arachne_files f ON f.id=c.file_id WHERE c.id=${alias}.chunk_id`,
      );
      connection.execute(`CREATE TRIGGER IF NOT EXISTS verdandi_${kind}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table} BEGIN
        UPDATE verdandi_input_state SET ${kind}_revision=${kind}_revision+1
        WHERE (project,agent) IN (${owners.join(' UNION ')}); END`);
    }
  }
}
