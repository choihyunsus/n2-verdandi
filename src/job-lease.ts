// Durable scoped leases fence late results after a crash, expiry or replacement.
import { randomUUID } from 'node:crypto';
import { integer, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';

export interface JobLease {
  kind: 'graph' | 'semantic';
  id: string;
}

export function acquireLease(store: GraphStore, kind: JobLease['kind']): JobLease {
  return store.connection.transaction(() => {
    const now = Date.now();
    const existing = store.connection.query<Record<string, unknown>>(
      'SELECT process_id,expires_at FROM verdandi_jobs WHERE project=? AND agent=? AND kind=?',
      [store.project, store.agent, kind],
    )[0];
    if (
      existing &&
      integer(existing.expires_at, 'lease expiry') > now &&
      processExists(integer(existing.process_id, 'lease process ID'))
    )
      throw new Error(`A ${kind} job is already running for this project and agent`);
    const id = randomUUID();
    store.connection.execute(
      `INSERT INTO verdandi_jobs VALUES(?,?,?,?,?,?,?) ON CONFLICT(project,agent,kind)
      DO UPDATE SET lease_id=excluded.lease_id,process_id=excluded.process_id,
      started_at=excluded.started_at,expires_at=excluded.expires_at`,
      [store.project, store.agent, kind, id, process.pid, now, now + 120000],
    );
    return { kind, id };
  });
}

export function assertLease(store: GraphStore, lease: JobLease): void {
  const row = store.connection.query<Record<string, unknown>>(
    'SELECT lease_id,expires_at FROM verdandi_jobs WHERE project=? AND agent=? AND kind=?',
    [store.project, store.agent, lease.kind],
  )[0];
  if (
    !row ||
    text(row.lease_id, 'lease ID') !== lease.id ||
    integer(row.expires_at, 'lease expiry') <= Date.now()
  )
    throw new Error('Job lease expired or was replaced; its result cannot be published');
}

export function releaseLease(store: GraphStore, lease: JobLease): void {
  store.connection.execute(
    'DELETE FROM verdandi_jobs WHERE project=? AND agent=? AND kind=? AND lease_id=?',
    [store.project, store.agent, lease.kind, lease.id],
  );
}

function processExists(pid: number): boolean {
  if (pid < 1) throw new Error('Invalid lease process ID');
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
