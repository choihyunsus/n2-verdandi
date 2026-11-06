// Host screening is optional, bounded and never confers verification on source text.
import type { DocumentInput, LearnOptions } from './document-types';

export async function screenDocument(
  document: DocumentInput,
  options: LearnOptions,
): Promise<number[]> {
  options.signal?.throwIfAborted();
  if (!options.screen) return document.chunks.map((_, index) => index);
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let timer: NodeJS.Timeout | undefined;
  let abort = (): void => {};
  try {
    return await Promise.race([
      screenChunks(document, options.screen, signal),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new Error('Document screening cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => controller.abort(new Error('Document screening exceeded 30 seconds')),
          30000,
        );
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function screenChunks(
  document: DocumentInput,
  screen: NonNullable<LearnOptions['screen']>,
  signal: AbortSignal,
): Promise<number[]> {
  const accepted: number[] = [];
  for (let index = 0; index < document.chunks.length; index++) {
    signal.throwIfAborted();
    const result = await screen(
      {
        path: document.path,
        hash: document.hash,
        index,
        total: document.chunks.length,
        text: document.chunks[index]!,
      },
      signal,
    );
    signal.throwIfAborted();
    if (typeof result !== 'boolean') throw new Error('Document screening must return a boolean');
    if (result) accepted.push(index);
  }
  if (!accepted.length) throw new Error('All document chunks were rejected by the host screen');
  return accepted;
}
