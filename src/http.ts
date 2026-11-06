// Serve only explicit read endpoints and bundled assets on the loopback interface.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { integer, relativePath } from 'n2-arachne/dist/lib/store-values.js';
import type { Verdandi } from './engine';
const BAD_REQUEST = 400;

export interface GraphViewer {
  url: string;
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function startGraphViewer(engine: Verdandi, port = 0): Promise<GraphViewer> {
  integer(port, 'viewer port', 65535);
  const assets = loadAssets();
  let origin = '',
    failure: Error | undefined;
  const server = http.createServer(
    { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 },
    (request, response) => serve(request, response, engine, origin, assets),
  );
  server.maxConnections = 16;
  server.keepAliveTimeout = 1000;
  let complete!: () => void;
  const closed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  server.once('close', complete);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('error', (error) => {
    failure = error;
    server.close();
    server.closeAllConnections();
  });
  let closing: Promise<void> | undefined;
  return {
    url: origin + '/verdandi/graph',
    closed: closed.then(() => {
      if (failure) throw failure;
    }),
    close: () => {
      if (!closing) {
        server.close();
        server.closeAllConnections();
        closing = closed;
      }
      return closing;
    },
  };
}

function serve(
  request: IncomingMessage,
  response: ServerResponse,
  engine: Verdandi,
  origin: string,
  assets: Map<string, { content: Buffer; type: string }>,
): void {
  try {
    setHeaders(response);
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new HttpFailure(403, 'Viewer requests require the local origin');
    if (request.method !== 'GET' && request.method !== 'HEAD')
      throw new HttpFailure(405, 'This graph viewer supports read requests');
    if (!request.url || request.url.length > 16384)
      throw new HttpFailure(BAD_REQUEST, 'Invalid request path');
    const url = new URL(request.url, origin);
    const asset = assets.get(url.pathname === '/' ? '/verdandi/graph' : url.pathname);
    if (asset) {
      response.setHeader('Content-Type', asset.type);
      response.setHeader('Content-Length', asset.content.length);
      response.end(request.method === 'HEAD' ? undefined : asset.content);
      return;
    }
    const value = route(url, engine),
      body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 8 * 1024 * 1024)
      throw new HttpFailure(413, 'Graph response exceeds 8 MiB; choose a narrower view');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.statusCode =
      error instanceof HttpFailure ? error.status : error instanceof URIError ? BAD_REQUEST : 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      request.method === 'HEAD'
        ? undefined
        : JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
  } finally {
    request.resume();
  }
}

function route(url: URL, engine: Verdandi): unknown {
  if (url.pathname === '/api/verdandi/graph/stats') {
    const status = engine.status();
    return {
      ...status,
      communities: status.communityCount,
      members: status.memberCount,
      bridges: status.bridgeCount,
      semantic_edges: status.semantic.edgeCount,
    };
  }
  if (url.pathname === '/api/verdandi/graph/overview') return engine.graph(0);
  for (const [kind, level] of [
    ['community', 1],
    ['node', 2],
  ] as const) {
    const prefix = `/api/verdandi/graph/${kind}/`;
    if (url.pathname.startsWith(prefix)) {
      const id = decodeURIComponent(url.pathname.slice(prefix.length));
      try {
        relativePath(id);
      } catch {
        throw new HttpFailure(BAD_REQUEST, 'Expected a normalized relative graph path');
      }
      const graph = engine.graph(level, id);
      if (!graph) throw new HttpFailure(404, 'Graph item was not found');
      return graph;
    }
  }
  throw new HttpFailure(404, 'Route was not found');
}

function loadAssets(): Map<string, { content: Buffer; type: string }> {
  const root = path.resolve(__dirname, '../static');
  return new Map(
    [
      ['/verdandi/graph', 'graph.html', 'text/html; charset=utf-8'],
      ['/verdandi/graph.js', 'graph.js', 'application/javascript; charset=utf-8'],
      ['/verdandi/graph-ui.js', 'graph-ui.js', 'application/javascript; charset=utf-8'],
      ['/verdandi/graph-render.js', 'graph-render.js', 'application/javascript; charset=utf-8'],
      ['/verdandi/d3.v7.min.js', 'd3.v7.min.js', 'application/javascript; charset=utf-8'],
      ['/verdandi/LICENSE-D3', 'LICENSE-D3', 'text/plain; charset=utf-8'],
    ].map(([route, filename, type]) => [
      route!,
      { content: fs.readFileSync(path.join(root, filename!)), type: type! },
    ]),
  );
}

function setHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
