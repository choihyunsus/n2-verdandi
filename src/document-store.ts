// Source invalidation, learning chains and receipt updates share Mimir's existing transaction.
import { text } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { DocumentInput, LearnResult } from './document-types';
import {
  currentReceipt,
  learningResult,
  ownedDocumentSource,
  readReceipt,
  type DocumentReceipt,
} from './document-receipts';
import { assertDocumentCurrent } from './document-input';

export function storeDocument(
  store: GraphStore,
  document: DocumentInput,
  accepted: number[],
  signal?: AbortSignal,
): LearnResult {
  assertDocumentCurrent(document);
  return store.connection.transaction(() => {
    signal?.throwIfAborted();
    const repeated = currentReceipt(store, document);
    if (repeated) return learningResult(document, repeated, 'already_learned');
    const deadline = Date.now() + 15000;
    invalidatePrevious(store, document, deadline);
    const sourceIds = insertSources(store, document, accepted, deadline);
    const insightIds = insertSummaries(store, document, accepted, sourceIds, deadline);
    const receipt = { sourceIds, insightIds, chunks: sourceIds.length };
    assertDocumentCurrent(document);
    checkDeadline(deadline);
    recordReceipt(store, document, receipt);
    return learningResult(document, receipt, 'learned');
  });
}

function invalidatePrevious(store: GraphStore, document: DocumentInput, deadline: number): void {
  const row = store.connection.query<{ hash: unknown; policy_id: unknown }>(
    'SELECT hash,policy_id FROM verdandi_docs WHERE project=? AND agent=? AND path=?',
    [store.project, store.agent, document.path],
  )[0];
  if (!row) return;
  const hash = text(row.hash, 'previous document hash'),
    policy = text(row.policy_id, 'previous document policy');
  const previous = readReceipt(store, document.path, hash, policy);
  if (!previous) throw new Error('Previous document receipt is missing');
  for (const id of previous.sourceIds) {
    checkDeadline(deadline);
    if (ownedDocumentSource(store, id, document.path, hash, policy))
      store.memory.reasoning.invalidateEvidence(id);
  }
}

function insertSources(
  store: GraphStore,
  document: DocumentInput,
  accepted: number[],
  deadline: number,
): string[] {
  return accepted.map((index) => {
    checkDeadline(deadline);
    const source = store.memory.insertExperience({
      project: store.project,
      agent: store.agent,
      type: 'pattern',
      category: 'doc_learn',
      context: JSON.stringify({
        source_path: document.path,
        source_hash: document.hash,
        policy_id: document.policyId,
        chunk: index + 1,
        total_chunks: document.chunks.length,
        verified: false,
      }),
      action: `Read document excerpt ${index + 1}/${document.chunks.length} from ${document.path}`,
      outcome: document.chunks[index]!,
      sourceRef: `document:${encodeURIComponent(document.path)}?sha256=${document.hash}#chunk=${index + 1}`,
    });
    return source.id;
  });
}

function insertSummaries(
  store: GraphStore,
  document: DocumentInput,
  accepted: number[],
  sourceIds: string[],
  deadline: number,
): string[] {
  const insightIds: string[] = [];
  for (let start = 0; start < sourceIds.length; start += 100) {
    checkDeadline(deadline);
    const previews = accepted
      .slice(start, start + 100)
      .map(
        (index) =>
          `Excerpt ${index + 1}: ${Array.from(document.chunks[index]!).slice(0, 80).join('')}`,
      );
    const insight = store.memory.insertInsight({
      project: store.project,
      agent: store.agent,
      scope: 'project',
      category: 'doc_learn',
      sourceIds: sourceIds.slice(start, start + 100),
      description: `Unverified document excerpts from ${document.path}\n${previews.join('\n')}`,
      compressed: `Source ${document.path}, SHA-256 ${document.hash}. Content requires independent verification.`,
    });
    const conclusion = store.memory.reasoning.buildInsightChain(insight.id);
    if (!conclusion || conclusion.isVerified)
      throw new Error('Document content must produce an unverified conclusion');
    insightIds.push(insight.id);
  }
  return insightIds;
}

function recordReceipt(store: GraphStore, document: DocumentInput, receipt: DocumentReceipt): void {
  const scope = [store.project, store.agent, document.path, document.hash, document.policyId];
  const now = Math.floor(Date.now() / 1000);
  store.connection.execute(
    `INSERT INTO verdandi_doc_receipts VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project,agent,path,hash,policy_id)
    DO UPDATE SET chunks=excluded.chunks,source_ids_json=excluded.source_ids_json,
    insight_ids_json=excluded.insight_ids_json,learned_at=excluded.learned_at`,
    [
      ...scope,
      receipt.chunks,
      JSON.stringify(receipt.sourceIds),
      JSON.stringify(receipt.insightIds),
      now,
    ],
  );
  store.connection.execute(
    `INSERT INTO verdandi_docs VALUES(?,?,?,?,?,?,?) ON CONFLICT(project,agent,path)
    DO UPDATE SET hash=excluded.hash,policy_id=excluded.policy_id,chunks=excluded.chunks,learned_at=excluded.learned_at`,
    [...scope, receipt.chunks, now],
  );
}

function checkDeadline(deadline: number): void {
  if (Date.now() > deadline)
    throw new Error('Document publication exceeded 15 seconds; transaction rolled back');
}
