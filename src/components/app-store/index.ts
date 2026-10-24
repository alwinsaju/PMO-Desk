// Registers the App Store into the app registry as a side effect of
// importing this module — see ARCHITECTURE.md's "app registry" section.
// `src/components/apps/index.ts` adds the one side-effect import for this
// file; nothing here needs to be exported, since Window.tsx only ever
// resolves app content through `getAppComponent(appId)`, never by
// importing a specific app's component directly.
import { registerLazyApp } from "@/components/apps/registry";

registerLazyApp("app-store", () =>
  import("./AppStoreApp").then((m) => ({ default: m.AppStoreApp })),
);
