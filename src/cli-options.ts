// Parse explicit ownership and command arguments without guessing a database or project.
import type { VerdandiOptions } from './storage-types';

export const COMMANDS = [
  'mcp',
  'status',
  'build',
  'scan',
  'semantic',
  'learn',
  'list',
  'community',
  'backlinks',
  'graph',
  'serve',
] as const;
export interface CliOptions {
  command: (typeof COMMANDS)[number];
  store: VerdandiOptions;
  argument?: string;
  force: boolean;
  includeSemantic: boolean;
  model?: string;
  level: 0 | 1 | 2;
  limit?: number;
  offset?: number;
  port: number;
}

export function parseCli(args: string[]): CliOptions {
  const { values, flags, positional } = readArguments(args);
  const command = positional.shift() ?? 'mcp';
  if (!COMMANDS.includes(command as CliOptions['command']))
    throw new Error(`Unknown command ${command}`);
  const level = numeric(values, 'level', 2) ?? 0;
  const needsPath =
    ['learn', 'community', 'backlinks'].includes(command) || (command === 'graph' && level !== 0);
  if (positional.length !== (needsPath ? 1 : 0))
    throw new Error(`Invalid positional arguments for ${command}`);
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`--${key} is required`);
    return value;
  };
  validateCommandOptions(command, values, flags);
  return {
    command: command as CliOptions['command'],
    store: {
      dbPath: required('db'),
      project: required('project'),
      agent: required('agent'),
      projectRoot: values.get('root'),
    },
    argument: positional[0],
    force: flags.has('force'),
    includeSemantic: !flags.has('no-semantic'),
    model: values.get('model'),
    level: level as 0 | 1 | 2,
    limit: numeric(values, 'limit', 1000),
    offset: numeric(values, 'offset', 20000),
    port: numeric(values, 'port', 65535) ?? 0,
  };
}

function readArguments(args: string[]) {
  const values = new Map<string, string>(),
    flags = new Set<string>(),
    positional: string[] = [];
  const valueOptions = new Set([
    'db',
    'project',
    'agent',
    'root',
    'model',
    'level',
    'limit',
    'offset',
    'port',
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (flags.has(key) || values.has(key)) throw new Error(`Duplicate option --${key}`);
    if (key === 'force' || key === 'no-semantic') {
      flags.add(key);
      continue;
    }
    if (!valueOptions.has(key)) throw new Error(`Unknown option ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Option ${arg} requires a value`);
    values.set(key, value);
  }
  return { values, flags, positional };
}

function numeric(values: Map<string, string>, key: string, maximum: number): number | undefined {
  const raw = values.get(key);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum)
    throw new Error(`--${key} must be an integer from 0 to ${maximum}`);
  if (key === 'limit' && Number(raw) === 0) throw new Error('--limit must be positive');
  return Number(raw);
}

function validateCommandOptions(
  command: string,
  values: Map<string, string>,
  flags: Set<string>,
): void {
  const allowed: Record<string, string[]> = {
    model: ['semantic'],
    level: ['graph'],
    limit: ['list', 'backlinks'],
    offset: ['list'],
    port: ['serve'],
    force: ['build', 'scan', 'semantic'],
    'no-semantic': ['backlinks'],
  };
  for (const [option, commands] of Object.entries(allowed)) {
    if ((values.has(option) || flags.has(option)) && !commands.includes(command))
      throw new Error(`--${option} is not supported by ${command}`);
  }
}

export const HELP = `n2-verdandi 1.0.0
Usage: n2-verdandi --db <mimir.db> --project <name> --agent <name> [--root <source>] <command>
Commands:
  mcp                         Start the stdio MCP server (default)
  status                      Read scoped status and freshness
  build [--force]             Publish structural communities from the existing index
  scan [--force]              Index the configured root and build after a complete scan
  semantic [--model <name>] [--force]
                              Publish semantic links from existing vectors
  learn <relative-path>       Read a document into unverified Mimir evidence
  list [--limit N] [--offset N]
                              List published communities
  community <id>              Read members and bridges
  backlinks <path> [--limit N] [--no-semantic]
                              Read imports, semantic neighbors and community peers
  graph --level <0|1|2> [id]   Read one of the three graph levels
  serve [--port N]            Open a read-only loopback graph server (0 selects a free port)
  --help                      Show this help
  --version                   Show the package version
Use -- before positional filenames beginning with --.
`;
