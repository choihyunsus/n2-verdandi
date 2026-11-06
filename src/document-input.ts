// Read a bounded canonical source and recheck its raw fingerprint after asynchronous screening.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractDocument, DOCUMENT_FORMATS } from 'n2-arachne/dist/lib/document-worker.js';
import { hashFile } from 'n2-arachne/dist/lib/file-hash.js';
import { readSource } from 'n2-arachne/dist/lib/scan-files.js';
import { relativePath } from 'n2-arachne/dist/lib/store-values.js';
import type { GraphStore } from './store';
import type { DocumentInput, LearnOptions } from './document-types';
import { chunkDocument } from './document-chunks';
import { bindSourceRoot } from './source-root';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export async function readDocument(
  store: GraphStore,
  filename: string,
  options: LearnOptions,
): Promise<DocumentInput> {
  options.signal?.throwIfAborted();
  if (!store.projectRoot) throw new Error('Document learning requires an explicit projectRoot');
  bindSourceRoot(store);
  const requested = path.resolve(store.projectRoot, relativePath(filename));
  const resolved = fs.realpathSync(requested),
    sourcePath = path.relative(store.projectRoot, resolved);
  if (sourcePath === '..' || sourcePath.startsWith('..' + path.sep) || path.isAbsolute(sourcePath))
    throw new Error('Document resolves outside its project root');
  if (!fs.statSync(resolved).isFile()) throw new Error('Document must be a regular file');
  const rawHash = hashFile(resolved, MAX_DOCUMENT_BYTES).sha256;
  const extracted = DOCUMENT_FORMATS.has(path.extname(resolved).slice(1).toLowerCase())
    ? await extractDocument(store.projectRoot, resolved, MAX_DOCUMENT_BYTES, options.signal)
    : readSource(store.projectRoot, resolved, MAX_DOCUMENT_BYTES);
  options.signal?.throwIfAborted();
  const normalized = extracted.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('Document text is empty');
  const document: DocumentInput = {
    path: (process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath).replace(
      /\\/g,
      '/',
    ),
    requested,
    filename: resolved,
    rawHash,
    policyId: policyId(options),
    chunks: chunkDocument(normalized),
    hash: createHash('sha256').update(normalized).digest('hex'),
  };
  assertDocumentCurrent(document);
  return document;
}

export function assertDocumentCurrent(document: DocumentInput): void {
  if (
    fs.realpathSync(document.requested) !== document.filename ||
    hashFile(document.filename, MAX_DOCUMENT_BYTES).sha256 !== document.rawHash
  )
    throw new Error('Document changed during learning; retry after the write completes');
}

function policyId(options: LearnOptions): string {
  if (options.screen === undefined && options.policyId === undefined) return 'unfiltered-source-v1';
  if (
    typeof options.screen !== 'function' ||
    typeof options.policyId !== 'string' ||
    !options.policyId.trim() ||
    Buffer.byteLength(options.policyId) > 128 ||
    options.policyId.includes('\0')
  )
    throw new Error('A document screen requires a stable policyId containing 1-128 bytes');
  return options.policyId;
}
