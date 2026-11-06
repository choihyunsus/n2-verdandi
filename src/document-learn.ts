// Ingest one source snapshot with explicit policy, idempotent receipts and atomic evidence handling.
import type { GraphStore } from './store';
import type { LearnOptions, LearnResult } from './document-types';
import { readDocument, assertDocumentCurrent } from './document-input';
import { currentReceipt, learningResult } from './document-receipts';
import { screenDocument } from './document-screen';
import { storeDocument } from './document-store';

export async function learnDocument(
  store: GraphStore,
  filename: string,
  options: LearnOptions = {},
): Promise<LearnResult> {
  const document = await readDocument(store, filename, options);
  const receipt = store.connection.transaction(() => currentReceipt(store, document));
  if (receipt) {
    assertDocumentCurrent(document);
    return learningResult(document, receipt, 'already_learned');
  }
  const accepted = await screenDocument(document, options);
  options.signal?.throwIfAborted();
  return storeDocument(store, document, accepted, options.signal);
}
