// Read portable vectors in bounded pages, excluding stale or inconsistent file inputs.
import { createHash, type Hash } from 'node:crypto';
import { embeddingSourceHash } from 'n2-arachne/dist/lib/vector-store.js';
import { decodeVector } from 'n2-arachne/dist/lib/vectors.js';
import { integer, relativePath, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { FileVector, SemanticSnapshot } from './semantic-types';
import { assertArachneSchema } from './graph-input';
import { boundedRows } from './graph-budget';

const VECTOR_QUERY = `FROM arachne_embeddings e JOIN arachne_chunks c ON c.id=e.chunk_id
  JOIN arachne_files f ON f.id=c.file_id WHERE f.project=? AND f.agent=? AND e.model=?`;
interface Accumulator {
  sum: Float64Array;
  digest: Hash;
  invalid: boolean;
}

export function readSemanticSnapshot(store: GraphStore, requestedModel?: string): SemanticSnapshot {
  return store.connection.transaction(() => {
    assertArachneSchema(store);
    const model = selectModel(store, requestedModel);
    const state = { excludedFiles: 0, invalidChunks: 0 };
    const files = model === null ? [] : readVectors(store, model, state);
    return { files, model, ...state, revision: semanticRevision(store) };
  });
}

export function semanticRevision(store: GraphStore): string {
  const row = store.connection.query<Record<string, unknown>>(
    `SELECT COALESCE((SELECT revision FROM arachne_scope_state WHERE project=? AND agent=?),0) AS source,
    vector_revision AS vector,(SELECT semantic_revision FROM verdandi_scope_state WHERE project=? AND agent=?) AS semantic
    FROM verdandi_input_state WHERE project=? AND agent=?`,
    [store.project, store.agent, store.project, store.agent, store.project, store.agent],
  )[0];
  if (!row) throw new Error('Semantic input state is missing');
  return ['source', 'vector', 'semantic']
    .map((key) => integer(row[key], `${key} revision`))
    .join(':');
}

function selectModel(store: GraphStore, requested?: string): string | null {
  if (
    requested !== undefined &&
    (typeof requested !== 'string' ||
      !requested.trim() ||
      Buffer.byteLength(requested) > 512 ||
      requested.includes('\0'))
  )
    throw new Error('Invalid embedding model');
  const models = boundedRows<{ model: unknown }>(
    store.connection,
    `SELECT DISTINCT e.model FROM arachne_embeddings e JOIN arachne_chunks c ON c.id=e.chunk_id
    JOIN arachne_files f ON f.id=c.file_id WHERE f.project=? AND f.agent=? ORDER BY e.model LIMIT 65`,
    [store.project, store.agent],
    64,
    ['model'],
    { remaining: 64 * 512 },
  ).map((row) => text(row.model, 'embedding model'));
  if (
    models.some((model) => !model.trim() || Buffer.byteLength(model) > 512 || model.includes('\0'))
  )
    throw new Error('Invalid stored embedding model');
  if (requested !== undefined) {
    if (models.length && !models.includes(requested))
      throw new Error('Requested embedding model has no vectors in this scope');
    return requested;
  }
  if (models.length > 1)
    throw new Error('Multiple embedding models found; select one model explicitly');
  return models[0] ?? null;
}

function readVectors(
  store: GraphStore,
  model: string,
  state: { excludedFiles: number; invalidChunks: number },
): FileVector[] {
  const args = [store.project, store.agent, model];
  assertVectorBudget(store, args);
  const files = new Map<string, Accumulator>();
  let lastId = 0;
  while (true) {
    const rows = store.connection.query<Record<string, unknown>>(
      `SELECT c.id,f.path,c.name,c.chunk_type,
      CASE WHEN length(c.content)<=65536 THEN c.content ELSE NULL END AS content,e.dimensions,
      CASE WHEN length(e.vector)<=32768 THEN hex(e.vector) ELSE '' END AS vector_hex,e.source_hash
      ${VECTOR_QUERY} AND c.id>? ORDER BY c.id LIMIT 64`,
      [...args, lastId],
    );
    if (!rows.length) break;
    for (const row of rows) {
      lastId = integer(row.id, 'vector chunk ID');
      const filename = relativePath(text(row.path, 'vector file path'));
      if (files.size >= 20000 && !files.has(filename))
        throw new Error('Semantic input exceeds 20,000 files');
      const accumulator = files.get(filename) ?? {
        sum: new Float64Array(0),
        digest: createHash('sha256'),
        invalid: false,
      };
      files.set(filename, accumulator);
      if (!accumulate(accumulator, row)) {
        accumulator.invalid = true;
        state.invalidChunks++;
      }
    }
  }
  const result: FileVector[] = [];
  for (const [filename, accumulator] of files) {
    const vector = finalize(filename, model, accumulator);
    if (vector) result.push(vector);
    else state.excludedFiles++;
  }
  return result.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function assertVectorBudget(store: GraphStore, args: string[]): void {
  const size = store.connection.query<{ count: unknown; bytes: unknown }>(
    `SELECT count(*) AS count,COALESCE(sum(bytes),0) AS bytes FROM (SELECT
    length(e.vector)+length(CAST(c.content AS BLOB))+length(CAST(f.path AS BLOB))+length(CAST(COALESCE(c.name,'') AS BLOB))
    +length(CAST(c.chunk_type AS BLOB))+length(CAST(e.source_hash AS BLOB)) AS bytes ${VECTOR_QUERY} LIMIT 50001)`,
    args,
  )[0];
  if (
    !size ||
    integer(size.count, 'vector row count') > 50000 ||
    integer(size.bytes, 'vector bytes') > 64 * 1024 * 1024
  )
    throw new Error('Semantic input exceeds 50,000 chunks or 64 MiB');
}

function accumulate(accumulator: Accumulator, row: Record<string, unknown>): boolean {
  try {
    const hash = embeddingSourceHash(row);
    if (text(row.source_hash, 'vector source hash') !== hash) return false;
    const hex = text(row.vector_hex, 'vector bytes');
    if (hex.length > 65536 || !/^(?:[a-f0-9]{2})+$/i.test(hex)) return false;
    const bytes = Buffer.from(hex, 'hex');
    const values = decodeVector(bytes, integer(row.dimensions, 'vector dimensions', 8192));
    if (accumulator.sum.length === 0) accumulator.sum = new Float64Array(values.length);
    if (accumulator.sum.length !== values.length) return false;
    for (let index = 0; index < values.length; index++) accumulator.sum[index]! += values[index]!;
    accumulator.digest.update(JSON.stringify([row.id, hash, values.length])).update(bytes);
    return true;
  } catch {
    return false;
  }
}

function finalize(path: string, model: string, accumulator: Accumulator): FileVector | null {
  if (accumulator.invalid) return null;
  const norm = Math.sqrt(accumulator.sum.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return null;
  const values = Float32Array.from(accumulator.sum, (value) => value / norm);
  const hash = accumulator.digest.update(JSON.stringify([model, values.length])).digest('hex');
  return { path, model, values, hash };
}
