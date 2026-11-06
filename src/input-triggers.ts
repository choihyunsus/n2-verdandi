// Track semantic changes from Verdandi or Skuld without modifying shared source records.
import type { SqlConnection } from './storage-types';

export function initializeSemanticTriggers(connection: SqlConnection): void {
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    const rows = event === 'UPDATE' ? ['OLD', 'NEW'] : [event === 'DELETE' ? 'OLD' : 'NEW'];
    const body = rows
      .map(
        (row) => `
      UPDATE verdandi_scope_state SET semantic_revision=semantic_revision+1 WHERE project=${row}.project AND agent=${row}.agent;
      INSERT INTO verdandi_dirty(project,agent,path,reason) SELECT ${row}.project,${row}.agent,${row}.source_path,'semantic'
        WHERE EXISTS(SELECT 1 FROM verdandi_scope_state WHERE project=${row}.project AND agent=${row}.agent)
        ON CONFLICT(project,agent,path) DO UPDATE SET reason='semantic',detected_at=unixepoch();
      INSERT INTO verdandi_dirty(project,agent,path,reason) SELECT ${row}.project,${row}.agent,${row}.target_path,'semantic'
        WHERE EXISTS(SELECT 1 FROM verdandi_scope_state WHERE project=${row}.project AND agent=${row}.agent)
        ON CONFLICT(project,agent,path) DO UPDATE SET reason='semantic',detected_at=unixepoch();`,
      )
      .join('\n');
    connection.execute(`CREATE TRIGGER IF NOT EXISTS verdandi_semantic_revision_${event.toLowerCase()}
      AFTER ${event} ON verdandi_semantic_edges BEGIN ${body} END`);
  }
}
