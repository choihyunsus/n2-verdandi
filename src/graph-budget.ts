// Reject excessive text before allocating rows or cloning graph input into a worker.
import { integer } from 'n2-arachne/dist/lib/store-values.js';
import type { SqlConnection } from './storage-types';
import type { GraphInput } from './graph-types';

export const MAX_GRAPH_TEXT_BYTES = 32 * 1024 * 1024;

export function boundedRows<T>(
  connection: SqlConnection,
  query: string,
  values: readonly (string | number | null)[],
  maximum: number,
  textColumns: string[],
  budget = { remaining: MAX_GRAPH_TEXT_BYTES },
): T[] {
  const lengths = textColumns.map((column) => `length(CAST(COALESCE(${column},'') AS BLOB))`);
  const row = connection.query<{ count: unknown; bytes: unknown }>(
    `SELECT count(*) AS count,COALESCE(sum(${lengths.join('+') || '0'}),0) AS bytes FROM (${query})`,
    values,
  )[0];
  if (!row || integer(row.count, 'row count') > maximum)
    throw new Error(`Graph input exceeds ${maximum.toLocaleString('en-US')} rows`);
  const bytes = integer(row.bytes, 'graph text size');
  if (bytes > budget.remaining) throw new Error('Graph text exceeds its 32 MiB input budget');
  budget.remaining -= bytes;
  return connection.query<T>(query, values);
}

export function validateGraphBudget(input: GraphInput): void {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges))
    throw new Error('Expected graph nodes and edges');
  if (input.nodes.length > 20000 || input.edges.length > 100000)
    throw new Error('Graph exceeds 20,000 nodes or 100,000 edges');
  let bytes = 0;
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || value.length > 4096)
      throw new Error('Invalid graph path or language');
    bytes += Buffer.byteLength(value);
    if (bytes > MAX_GRAPH_TEXT_BYTES) throw new Error('Graph text exceeds its 32 MiB input budget');
  };
  for (const node of input.nodes) {
    add(node?.path);
    if (node.language !== null) add(node.language);
  }
  for (const edge of input.edges) {
    add(edge?.source);
    add(edge?.target);
  }
}
