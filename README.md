# N2 Verdandi

Structural communities, semantic file connections and source-linked document learning over the common Soul database.

[한국어 안내](README.ko.md)

Verdandi indexes a configured project through Arachne, groups related files, and serves an interactive graph with overview, community and file-neighbor views. It also reads documents into Mimir with traceable source evidence and explicit verification state.

## Install

Use Node.js 20.19 or later. The release archive contains compiled JavaScript and the local graph viewer.

```sh
npm install https://github.com/choihyunsus/n2-verdandi/releases/download/v1.0.0/n2-verdandi-1.0.0.tgz
```

The pinned runtime packages are Arachne 5.0.0 and Mimir 3.0.3. Their GitHub release archives are resolved during installation.

For PDF, DOCX, XLSX and PPTX, Arachne provides a separate bounded Rust parser. Its dependency archive includes the Windows x64 parser. On other platforms, install Rust 1.98 or later and build the parser in the consuming project.

```sh
npm --prefix node_modules/n2-arachne run build:documents
```

`N2_ARACHNE_DOCUMENT_WORKER` can select an explicitly provisioned parser executable. Text and Markdown ingestion use the built-in UTF-8 reader.

## Quick start

Choose a database file, a stable project name, a stable agent name and an existing source directory. Matching project and agent values connect the same Arachne index, Verdandi graph and Mimir learning scope.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant --root ./source scan
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant status
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant serve
```

`serve` prints a loopback URL. Open it to navigate communities, search paths, drag nodes, zoom, go back and adjust text size. Refresh reloads the published data. Run `scan` again after source changes.

An incomplete scan returns its issues and `graph: null`, preserving the last published graph. A separate `build` command can explicitly publish the current index and reports its coverage.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant build
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant list --limit 20
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant backlinks src/index.ts
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant --root ./source learn docs/design.md
```

## Library

Save this example as `demo.mjs`.

```js
import { Verdandi } from 'n2-verdandi';

const graph = new Verdandi({
  dbPath: './memory/mimir.db',
  project: 'demo',
  agent: 'assistant',
  projectRoot: './source',
});

try {
  const refreshed = await graph.scan();
  const status = graph.status();
  const groups = graph.communities(20, 0);
  const overview = graph.graph(0);
  const learned = await graph.learn('docs/design.md');
  console.log({ refreshed, status, groups, overview, learned });
} finally {
  await graph.close();
}
```

ES module named imports and TypeScript declarations are included. `startGraphViewer(graph, port)` returns `url`, `closed` and an asynchronous `close()` method. Close the viewer before closing its engine.

| Method | Result |
| --- | --- |
| `scan({ force, signal })` | Arachne scan receipt and graph receipt after complete indexing |
| `build({ force, signal })` | Full, incremental or unchanged graph receipt with current coverage |
| `semantic({ model, force, signal })` | Semantic connection counts, excluded inputs and comparison statistics |
| `learn(path, { signal, screen, policyId })` | Source hash, accepted/rejected chunk counts and durable memory IDs |
| `status()` | Published/current revisions, index coverage, semantic freshness, documents and job leases |
| `communities(limit, offset)` | Paginated published groups |
| `community(id)` | Members and weighted bridges, or `null` |
| `graph(level, id)` | Overview at 0, community at 1, file neighbors at 2 |
| `backlinks(path, { limit, includeSemantic })` | Incoming imports, freshness-weighted semantic neighbors and community peers |
| `close()` | Cancel active work, wait for cleanup, then close storage |

File inputs use normalized project-relative paths. Document learning and scanning require `projectRoot`. Each project/agent pair binds to one canonical root. Read-only graph operations can use the database without a source directory.

## MCP

Configure the installed CLI with explicit ownership. A typical MCP host configuration uses the following server entry.

```json
{
  "mcpServers": {
    "verdandi": {
      "command": "node",
      "args": [
        "/absolute/project/node_modules/n2-verdandi/dist/index.js",
        "--db", "/absolute/memory/mimir.db",
        "--project", "demo",
        "--agent", "assistant",
        "--root", "/absolute/source",
        "mcp"
      ]
    }
  }
}
```

The nine tools are `verdandi_scan`, `verdandi_build`, `verdandi_semantic`, `verdandi_learn_doc`, `verdandi_status`, `verdandi_list`, `verdandi_read`, `verdandi_backlinks` and `verdandi_graph`. Requests use the configured project and agent. Cancellation propagates to indexing, CPU workers, document extraction and screening.

## Graph behavior

Arachne supplies resolved directional imports. Verdandi combines import and semantic pairs into a deduplicated, undirected graph with equal input edge weights. Code communities exclude `md` and `txt` nodes. Semantic similarity remains available on each semantic edge.

Deterministic Louvain clustering preserves internal self-loop mass and crossing multiplicity during coarsening. Each accepted level improves modularity on the original graph. Community IDs derive from representative paths and can change after regrouping.

Unchanged topology returns stored counts. Small updates expand to complete old communities and current connected components. Incremental clustering requires at most 2,000 nodes, the same global edge count, and an affected region within 30% of the current graph. Other updates use full clustering.

Computation runs outside the publication transaction. Durable job leases and input revisions fence stale results. Graph rows, hashes and dirty acknowledgements commit together. Failed publication preserves the preceding graph. Three changed-input attempts produce an explicit retry error.

## Semantic connections

Generate embeddings through Arachne's embedding workflow, then run semantic construction.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant semantic --model nomic-embed-text
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant build
```

Verdandi checks each embedding against its complete current chunk input hash, model, finite Float32 values and dimensions. It averages and normalizes valid chunks per file. A stale or inconsistent chunk excludes its file and appears in the result counts. Multiple available models require an explicit selection. Comparisons stay within the selected model and matching dimensions.

Cosine similarity of at least 0.65 qualifies a candidate connection. The strongest 10,000 pairs are retained with stable path ordering for ties. These connections express similarity candidates for review. Incremental selection includes actual vector changes and deletions. A saturated previous selection or externally edited edge set causes a full calculation.

Stored edge timestamps use Unix seconds. Backlinks use Skuld's `code_pattern` freshness weight, `1 / (1 + 0.005 × age_in_days)`, multiplied by similarity.

## Document evidence

Document learning stores `pattern` experiences with source path, normalized-text SHA-256, chunk position and screening policy. Groups of up to 100 source experiences produce an insight with an explicit unverified reasoning conclusion. Mimir's automatic graduation checks retain that verification requirement.

Receipts are scoped by project, agent, canonical relative path, content hash and policy ID. Repeated and concurrent reads reuse valid references. Changed sources invalidate previous evidence and place dependent insights into review through Mimir. Restoring an earlier source version creates fresh references when its earlier evidence has been invalidated. Historical experiences remain traceable.

The default policy accepts document text as unverified source material. Hosts can provide a screening callback and a stable policy version.

```js
await graph.learn('docs/reference.md', {
  policyId: 'my-screen-v1',
  screen: async (chunk, signal) => {
    signal.throwIfAborted();
    return mySourcePolicy(chunk.text);
  },
});
```

Advance `policyId` when the screening policy changes. Every rejected chunk is counted. A fully rejected document or failed screen leaves learning storage untouched. Screening has a 30-second deadline. Source fingerprints are checked again before publication completes.

## Shared storage

Use the same explicit `mimir.db` path as distribution Soul. Mimir initializes the common schema version 2 and preserves its experience/insight fields. Verdandi owns its `verdandi_*` tables and schema version 1. The semantic-edge table retains the published Skuld scope, model and Unix-timestamp contract.

Existing scoped Skuld semantic tables are accepted. Unscoped historical Daebung tables require an explicit ownership migration into a separate database. Future schema versions produce an error. Select source ownership before migrating historical data.

## Resource bounds

| Operation | Bound |
| --- | --- |
| Concurrent engine operations | Eight |
| Graph input | 20,000 nodes, 100,000 edges, 32 MiB aggregate graph text |
| CPU worker | 30 seconds, 256 MiB old-generation and 32 MiB young-generation JavaScript heap |
| Semantic input | 50,000 chunks, 20,000 files, 64 MiB source/vector bytes, 1–8,192 dimensions |
| Semantic comparison | 200 million dimension operations per attempt, strongest 10,000 edges |
| Document input | 10 MiB per source, at most 8,192 chunks of at most 8,192 UTF-16 code units |
| Document publication | 15-second checked transaction budget |
| Viewer drawing | 800 nodes and 4,000 links, with all returned nodes available through search |
| Viewer simulation | Five-second settling window, restarted for dragging |
| HTTP/MCP response | 8 MiB |

The parser uses Windows Job memory limits, Linux address-space limits and a sampled macOS resident-memory watchdog. Sampling on macOS can overshoot its resident-memory threshold between checks. CPU-worker heap settings apply to the worker's JavaScript heap, while input bounds also constrain transferred vector data.

The loopback viewer serves bundled assets and read endpoints with local-origin checks. It retains the last drawing on navigation errors and reports stale or partial data. Semantic accuracy depends on the supplied embeddings and project content.

## Development and verification

```sh
npm ci
npm run build:documents
npm test
npm run typecheck
npm audit --omit=dev
npm pack --dry-run
```

The suite exercises actual shared SQLite state, source indexing, incremental/full graph equivalence, rollback, restart, cancellation, lease recovery, semantic selection, document evidence, binary parsing, CLI, stdio MCP, HTTP and viewer navigation logic. CI runs the suite on Windows, Linux and macOS with Node.js 22. Windows validation also exercises the optional Mimir Rust binding. Browser verification covers desktop and 390px layouts, three-level keyboard navigation, search, text sizing, failed-navigation recovery and drawing limits.

## Licenses

Verdandi code carries the MIT license in `LICENSE`. Arachne and Mimir retain their custom non-commercial/commercial terms in `LICENSE-ARACHNE` and `LICENSE-MIMIR`, with the accompanying `LICENSE-APACHE`. Bundled D3 uses the ISC license in `static/LICENSE-D3`. Component origins and the reused test-fixture generator are listed in `THIRD-PARTY-NOTICES`.
