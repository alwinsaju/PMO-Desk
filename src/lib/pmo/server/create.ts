// Builds the store, ingestor and structuring worker for one data directory.
// Kept apart from service.ts (which adds the timer and the real model) so
// tests can build one on a temp directory with a fake model.
import type { Pmo } from "./actions.ts";
import { Ingestor } from "./ingest.ts";
import { resolveInboxDir } from "./paths.ts";
import { Store } from "./store.ts";
import { StructuringWorker, type Generator } from "./structure.ts";

export async function createPmo(options: {
  dataDir: string;
  /** Overrides env/config for where the inbox is (tests). */
  inboxDir?: string;
  generator: Generator;
  now?: () => Date;
}): Promise<Pmo> {
  const store = new Store(options.dataDir);
  await store.init();
  const now = options.now ?? (() => new Date());
  const ingestor = new Ingestor({
    store,
    inboxDir: (config) => options.inboxDir ?? resolveInboxDir(config.inboxDir),
    now: () => now().getTime(),
  });
  const worker = new StructuringWorker({
    store,
    generator: options.generator,
    now: () => now().getTime(),
  });
  return { store, ingestor, worker, now };
}
