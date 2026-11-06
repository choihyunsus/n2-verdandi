// MCP tools operate on the configured owner and forward request cancellation to running jobs.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Verdandi } from './engine';
const pathSchema = z.string().min(1).max(4096);

export function createMcpServer(engine: Verdandi): McpServer {
  const server = new McpServer(
    { name: 'n2-verdandi', version: '1.0.0' },
    { maxToolInputElements: 100 },
  );
  server.registerTool(
    'verdandi_status',
    {
      description: 'Read scoped index, graph, semantic and document status.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result(() => engine.status()),
  );
  registerWriteTools(server, engine);
  registerReadTools(server, engine);
  return server;
}

function registerWriteTools(server: McpServer, engine: Verdandi): void {
  server.registerTool(
    'verdandi_build',
    {
      description:
        'Build communities from existing Arachne and semantic inputs. Returns source coverage and update strategy.',
      inputSchema: { force: z.boolean().optional() },
    },
    async ({ force }, extra) => result(() => engine.build({ force, signal: extra.signal })),
  );
  server.registerTool(
    'verdandi_semantic',
    {
      description:
        'Build scoped semantic links from existing Arachne vectors. Explicit model selection is required when multiple models are present.',
      inputSchema: { model: z.string().min(1).max(512).optional(), force: z.boolean().optional() },
    },
    async ({ model, force }, extra) =>
      result(() => engine.semantic({ model, force, signal: extra.signal })),
  );
  server.registerTool(
    'verdandi_learn_doc',
    {
      description:
        'Read a project-relative document into unverified, source-linked Mimir evidence. Requires configured projectRoot.',
      inputSchema: { path: pathSchema },
    },
    async ({ path }, extra) => result(() => engine.learn(path, { signal: extra.signal })),
  );
  server.registerTool(
    'verdandi_scan',
    {
      description:
        'Index the configured projectRoot with Arachne, then build communities. Incomplete scans return graph=null and preserve the previous graph.',
      inputSchema: { force: z.boolean().optional() },
    },
    async ({ force }, extra) => result(() => engine.scan({ force, signal: extra.signal })),
  );
}

function registerReadTools(server: McpServer, engine: Verdandi): void {
  server.registerTool(
    'verdandi_list',
    {
      description: 'List published communities with pagination and freshness.',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).max(20000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, offset }) => result(() => engine.communities(limit, offset)),
  );
  server.registerTool(
    'verdandi_read',
    {
      description: 'Read one community, its members and weighted bridges.',
      inputSchema: { id: pathSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => result(() => required(engine.community(id))),
  );
  server.registerTool(
    'verdandi_backlinks',
    {
      description:
        'Read incoming imports, freshness-weighted semantic neighbors and community peers.',
      inputSchema: {
        path: pathSchema,
        limit: z.number().int().min(1).max(1000).optional(),
        includeSemantic: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, ...options }) => result(() => required(engine.backlinks(path, options))),
  );
  server.registerTool(
    'verdandi_graph',
    {
      description:
        'Read a graph view. Level 0 is the overview, level 1 requires a community ID, level 2 requires an exact file path.',
      inputSchema: {
        level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        id: pathSchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ level, id }) => result(() => required(engine.graph(level, id))),
  );
}

async function result(read: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await read(),
      encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
      throw new Error('Tool response exceeds 8 MiB; request a narrower graph view');
    return { content: [{ type: 'text', text: encoded }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function required<T>(value: T | null): T {
  if (value === null)
    throw new Error('Requested graph item was not found in this project and agent');
  return value;
}
