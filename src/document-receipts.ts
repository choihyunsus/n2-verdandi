// Reuse receipts only while their exact owned source evidence remains present and valid.
import { integer, text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { DocumentInput, LearnResult } from './document-types';
import { boundedRows } from './graph-budget';

export interface DocumentReceipt {
  sourceIds: string[];
  insightIds: string[];
  chunks: number;
}

export function readReceipt(
  store: GraphStore,
  path: string,
  hash: string,
  policyId: string,
): DocumentReceipt | undefined {
  const row = boundedRows<Record<string, unknown>>(
    store.connection,
    'SELECT chunks,source_ids_json,insight_ids_json FROM verdandi_doc_receipts WHERE project=? AND agent=? AND path=? AND hash=? AND policy_id=?',
    [store.project, store.agent, path, hash, policyId],
    1,
    ['source_ids_json', 'insight_ids_json'],
    { remaining: 1024 * 1024 },
  )[0];
  if (!row) return undefined;
  const sourceIds = ids(row.source_ids_json, 8192),
    insightIds = ids(row.insight_ids_json, 82);
  const chunks = integer(row.chunks, 'learned chunk count', 8192);
  if (!chunks || chunks !== sourceIds.length || insightIds.length !== Math.ceil(chunks / 100))
    throw new Error('Document receipt has inconsistent memory references');
  return { sourceIds, insightIds, chunks };
}

export function currentReceipt(
  store: GraphStore,
  document: DocumentInput,
): DocumentReceipt | undefined {
  const current = store.connection.query<{ hash: unknown; policy_id: unknown }>(
    'SELECT hash,policy_id FROM verdandi_docs WHERE project=? AND agent=? AND path=?',
    [store.project, store.agent, document.path],
  )[0];
  if (current?.hash !== document.hash || current.policy_id !== document.policyId) return undefined;
  const receipt = readReceipt(store, document.path, document.hash, document.policyId);
  if (!receipt) throw new Error('Current document receipt is missing');
  const indices = new Set<number>();
  for (const id of receipt.sourceIds) {
    const source = ownedDocumentSource(store, id, document.path, document.hash, document.policyId);
    if (
      !source ||
      source.type !== 'pattern' ||
      source.outcome !== document.chunks[source.chunk - 1]
    )
      return undefined;
    if (indices.has(source.chunk)) throw new Error('Document receipt repeats one source chunk');
    indices.add(source.chunk);
    if (
      store.connection.query('SELECT 1 FROM mimir_evidence_invalidations WHERE experience_id=?', [
        id,
      ]).length
    )
      return undefined;
  }
  return summariesCurrent(store, receipt) ? receipt : undefined;
}

function summariesCurrent(store: GraphStore, receipt: DocumentReceipt): boolean {
  const expected = new Set(receipt.sourceIds),
    linked = new Set<string>();
  for (const id of receipt.insightIds) {
    const insight = store.memory.getInsight(id);
    if (!insight) return false;
    if (insight.agent !== store.agent || insight.category !== 'doc_learn')
      throw new Error('Document receipt refers to another memory owner or category');
    const sources = boundedRows<{ experience_id: unknown }>(
      store.connection,
      'SELECT experience_id FROM experience_insight_links WHERE insight_id=? LIMIT 101',
      [id],
      100,
      ['experience_id'],
    );
    for (const row of sources) {
      const source = text(row.experience_id, 'document insight source');
      if (!expected.has(source) || linked.has(source))
        throw new Error('Document insight exceeds its receipt evidence');
      linked.add(source);
    }
    if (!store.memory.reasoning.latestConclusion(id)) return false;
  }
  return linked.size === expected.size;
}

export function ownedDocumentSource(
  store: GraphStore,
  id: string,
  path: string,
  hash: string,
  policyId: string,
): { outcome: string; type: string; chunk: number } | undefined {
  const source = store.memory.getExperience(id);
  if (!source) return undefined;
  let context: unknown;
  try {
    context = JSON.parse(source.context);
  } catch {
    throw new Error('Invalid document source provenance');
  }
  const evidence = context as Record<string, unknown> | null;
  if (
    source.project !== store.project ||
    source.agent !== store.agent ||
    source.category !== 'doc_learn' ||
    !evidence ||
    evidence.source_path !== path ||
    evidence.source_hash !== hash ||
    evidence.policy_id !== policyId
  )
    throw new Error('Document receipt refers to a different source or memory owner');
  const chunk = integer(evidence.chunk, 'document chunk index', 8192);
  if (chunk < 1) throw new Error('Invalid document chunk index');
  return { outcome: source.outcome, type: source.type, chunk };
}

export function learningResult(
  document: DocumentInput,
  receipt: DocumentReceipt,
  status: LearnResult['status'],
): LearnResult {
  return {
    path: document.path,
    hash: document.hash,
    policyId: document.policyId,
    status,
    chunks: receipt.chunks,
    rejectedChunks: document.chunks.length - receipt.chunks,
    sourceIds: receipt.sourceIds,
    insightIds: receipt.insightIds,
    verified: false,
  };
}

function ids(value: unknown, maximum: number): string[] {
  const encoded = text(value, 'document receipt references');
  if (encoded.length > maximum * 80 + 2)
    throw new Error('Document receipt references exceed their limit');
  const parsed: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(parsed) ||
    parsed.length > maximum ||
    new Set(parsed).size !== parsed.length ||
    parsed.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
  )
    throw new Error('Invalid document receipt reference IDs');
  return parsed as string[];
}
