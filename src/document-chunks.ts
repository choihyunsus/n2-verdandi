// Prefer headings, paragraphs and whole fences while enforcing a Unicode-safe hard limit.
const TARGET = 1500;
const MAXIMUM = 8192;

export function chunkDocument(text: string): string[] {
  const blocks: string[] = [],
    lines: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  const flush = (): void => {
    const block = lines.join('\n').trim();
    if (block) blocks.push(block);
    lines.length = 0;
  };
  for (const line of text.split('\n')) {
    const opening = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && (opening || /^\s*#{1,6}\s/.test(line))) flush();
    if (opening && !fence) fence = { marker: opening[0]!, length: opening.length };
    else if (
      fence &&
      opening &&
      opening[0] === fence.marker &&
      opening.length >= fence.length &&
      line.trim() === opening
    ) {
      lines.push(line);
      flush();
      fence = undefined;
      continue;
    }
    if (!fence && !line.trim()) flush();
    else lines.push(line);
  }
  flush();
  return combineBlocks(blocks);
}

function combineBlocks(blocks: string[]): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    for (const part of boundedParts(block)) {
      if (current && current.length + part.length + 2 > TARGET) {
        chunks.push(current);
        current = '';
      }
      current += (current ? '\n\n' : '') + part;
      if (chunks.length >= 8192) throw new Error('Document exceeds 8,192 chunks');
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function* boundedParts(block: string): Generator<string> {
  for (let offset = 0; offset < block.length; ) {
    let end = Math.min(block.length, offset + MAXIMUM);
    if (end < block.length && /[\uD800-\uDBFF]/.test(block[end - 1]!)) end--;
    yield block.slice(offset, end);
    offset = end;
  }
}
