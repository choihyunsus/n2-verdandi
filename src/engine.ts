// The public engine owns running jobs and waits for their cancellation before closing storage.
import { GraphStore } from './store';
import type { VerdandiOptions } from './storage-types';
import { buildGraph, type BuildOptions } from './builder';
import type { BuildResult } from './build-types';
import { readStatus } from './status';
import { buildSemantic } from './semantic';
import type { SemanticOptions, SemanticResult } from './semantic-types';
import { learnDocument } from './document-learn';
import type { LearnOptions, LearnResult } from './document-types';
import { listCommunities, readCommunity } from './graph-read';
import { readGraphView } from './graph-view';
import { readBacklinks, type BacklinkOptions } from './backlinks';
import { scanAndBuild } from './scan';

export class Verdandi {
  private readonly store: GraphStore;
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private closing?: Promise<void>;

  constructor(options: VerdandiOptions) {
    this.store = new GraphStore(options);
  }

  async build(options: BuildOptions = {}): Promise<BuildResult> {
    return this.run(options.signal, (signal) => buildGraph(this.store, { ...options, signal }));
  }

  async scan(options: BuildOptions = {}) {
    return this.run(options.signal, (signal) => scanAndBuild(this.store, { ...options, signal }));
  }

  async semantic(options: SemanticOptions = {}): Promise<SemanticResult> {
    return this.run(options.signal, (signal) => buildSemantic(this.store, { ...options, signal }));
  }

  async learn(filename: string, options: LearnOptions = {}): Promise<LearnResult> {
    return this.run(options.signal, (signal) =>
      learnDocument(this.store, filename, { ...options, signal }),
    );
  }

  private async run<T>(
    provided: AbortSignal | undefined,
    start: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    if (this.active.size >= 8)
      throw new Error('Eight operations are already running in this engine');
    const signal = provided
      ? AbortSignal.any([provided, this.shutdown.signal])
      : this.shutdown.signal;
    const work = start(signal);
    this.active.add(work);
    try {
      return await work;
    } finally {
      this.active.delete(work);
    }
  }

  status() {
    this.assertOpen();
    return { ...readStatus(this.store), activeOperations: this.active.size };
  }

  communities(limit?: number, offset?: number) {
    this.assertOpen();
    return listCommunities(this.store, limit, offset);
  }

  community(id: string) {
    this.assertOpen();
    return readCommunity(this.store, id);
  }

  graph(level: 0 | 1 | 2, id?: string) {
    this.assertOpen();
    return readGraphView(this.store, level, id);
  }

  backlinks(filename: string, options?: BacklinkOptions) {
    this.assertOpen();
    return readBacklinks(this.store, filename, options);
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.shutdown.abort(new Error('Verdandi is closing'));
      this.closing = Promise.allSettled([...this.active]).then(() => this.store.close());
    }
    return this.closing;
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('Verdandi is closed');
  }
}
