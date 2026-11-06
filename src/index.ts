#!/usr/bin/env node
// Command-line and stdio entry points share the same scoped engine and graceful shutdown.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Verdandi } from './engine';
import { parseCli, HELP, type CliOptions } from './cli-options';
import { createMcpServer } from './mcp';
import { startGraphViewer } from './http';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const separator = args.indexOf('--');
  const globalArgs = separator < 0 ? args : args.slice(0, separator);
  if (globalArgs.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  if (globalArgs.includes('--version')) {
    process.stdout.write('1.0.0\n');
    return;
  }
  const options = parseCli(args),
    engine = new Verdandi(options.store);
  const abort = new AbortController();
  const interrupt = () => {
    process.exitCode = 130;
    abort.abort(new Error('Command interrupted'));
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    if (options.command === 'mcp') await runMcp(engine, abort.signal);
    else if (options.command === 'serve') await runViewer(engine, options.port, abort.signal);
    else
      process.stdout.write(
        JSON.stringify(await command(engine, options, abort.signal), null, 2) + '\n',
      );
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await engine.close();
  }
}

function command(engine: Verdandi, options: CliOptions, signal: AbortSignal): unknown {
  switch (options.command) {
    case 'status':
      return engine.status();
    case 'build':
      return engine.build({ force: options.force, signal });
    case 'scan':
      return engine.scan({ force: options.force, signal });
    case 'semantic':
      return engine.semantic({ model: options.model, force: options.force, signal });
    case 'learn':
      return engine.learn(options.argument!, { signal });
    case 'list':
      return engine.communities(options.limit, options.offset);
    case 'community':
      return required(engine.community(options.argument!));
    case 'backlinks':
      return required(
        engine.backlinks(options.argument!, {
          limit: options.limit,
          includeSemantic: options.includeSemantic,
        }),
      );
    case 'graph':
      return required(engine.graph(options.level, options.argument));
    default:
      throw new Error('Unsupported one-shot command');
  }
}

async function runMcp(engine: Verdandi, signal: AbortSignal): Promise<void> {
  const server = createMcpServer(engine);
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  server.server.onclose = finished;
  process.stdin.once('end', finished);
  const close = () => finished();
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    await server.connect(new StdioServerTransport());
    await done;
  } finally {
    process.stdin.removeListener('end', finished);
    signal.removeEventListener('abort', close);
    await engine.close();
    await server.close();
  }
}

async function runViewer(engine: Verdandi, port: number, signal: AbortSignal): Promise<void> {
  const viewer = await startGraphViewer(engine, port);
  const close = () => {
    void viewer.close();
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    process.stdout.write(viewer.url + '\n');
    if (signal.aborted) close();
    await viewer.closed;
  } finally {
    signal.removeEventListener('abort', close);
    await viewer.close();
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Requested graph item was not found');
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = process.exitCode || 1;
});
