// Shared set-up for the server tests of a proposal's title, fallback marker and
// owner: a throwaway data folder and inbox, a fixed clock, a way to drop a
// message in and get its proposal, and a fake model. Not a test file itself.
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPmo } from "./create.ts";
import { developerConfig } from "../developerDefaults.ts";
import { createStubGenerator } from "./stubGenerator.ts";
import { AiStructuredSchema } from "../types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "..", "pmo-intake", "examples");

export const SETUP = {
  names: ["Alex Morgan", "Alex"],
  emails: ["alex.morgan@example.com"],
};
/** The subject of the example message every test starts from. */
export const SUBJECT = "Q4 programme status pack - input needed";

/** A model that answers with the same task every time. */
export const fakeModel = (patch) => ({
  model: () => "fake-model",
  generate: async () =>
    AiStructuredSchema.parse({
      isActionable: true,
      title: "Send the RAID log",
      description: "Pat needs it.",
      owner: { name: null, email: null, isMe: true },
      requester: { name: "Pat Sample", email: null },
      dueAt: null,
      dueBasis: "none",
      priority: "normal",
      actionItems: [],
      checkpointTemplate: "simple",
      waitingOn: null,
      quote: "send me the consolidated RAID log",
      ...patch,
    }),
});

/** Use as `const kit = proposalKit(); beforeEach(kit.setup); afterEach(kit.teardown);`. */
export function proposalKit() {
  const kit = {
    dataDir: "",
    inboxDir: "",
    clock: new Date("2026-10-23T05:00:00.000Z"),
    counter: 0,
    async setup() {
      kit.dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-data-"));
      kit.inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-inbox-"));
    },
    async teardown() {
      await rm(kit.dataDir, { recursive: true, force: true });
      await rm(kit.inboxDir, { recursive: true, force: true });
    },
    stub: () => createStubGenerator({ dataDir: kit.dataDir }),
    /** A PMO set up for `me` (the names and addresses given at setup). */
    open: (generator, me) =>
      createPmo({
        dataDir: kit.dataDir,
        inboxDir: kit.inboxDir,
        seedConfig: developerConfig({ inboxDir: kit.inboxDir, me }),
        generator,
        now: () => kit.clock,
      }),
    /** Drop the example message (with `patch` applied), structure it, and return
     *  the newest proposal. */
    async structure(pmo, patch = {}) {
      const base = JSON.parse(
        await readFile(path.join(examplesDir, "outlook-task.json"), "utf8"),
      );
      kit.counter++;
      const file = path.join(kit.inboxDir, `m${kit.counter}.json`);
      await mkdir(kit.inboxDir, { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          ...base,
          sourceId: `m${kit.counter}`,
          thread: { conversationId: `conv-${kit.counter}`, parentId: null },
          ...patch,
        }),
      );
      const aged = new Date(kit.clock.getTime() - 60_000);
      await utimes(file, aged, aged);
      await pmo.ingestor.scan();
      await pmo.worker.kick();
      await pmo.worker.idle();
      const all = await pmo.store.listProposals();
      return all[all.length - 1];
    },
  };
  return kit;
}
