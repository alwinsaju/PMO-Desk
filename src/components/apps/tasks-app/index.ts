// Registers the Tasks app into the app registry as a side effect of
// importing this module — see ARCHITECTURE.md's "app registry" section and
// src/components/apps/notes-app/index.ts for the pattern this mirrors.
// `src/components/apps/index.ts` adds the one side-effect import for this
// file; nothing here needs to be exported, since Window.tsx only ever
// resolves app content through `getAppComponent(appId)`.
//
// Registers TasksAppGate (not TasksApp itself) — the gate auto-launches
// the agent-office backend and shows a loading/error screen before handing
// off to the real <TasksApp>. See TasksAppGate.tsx.
import { registerLazyApp } from "../registry";

registerLazyApp("tasks", () =>
  import("./TasksAppGate").then((m) => ({ default: m.TasksAppGate })),
);
