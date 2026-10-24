// Registers the generic web-app window into the app registry as a side
// effect of importing this module — see ARCHITECTURE.md's "app registry"
// section and src/components/app-store/index.ts for the pattern this
// mirrors. `src/components/apps/index.ts` adds the one side-effect import
// for this file; nothing here needs to be exported, since Window.tsx only
// ever resolves app content through `getAppComponent(appId)`.
//
// Unlike the other demo apps, "web-app" is never opened directly from the
// dock — it's a single shared window type every REAL App Store catalog
// entry opens into (with a different `url`/`embeddable` per instance). See
// WebAppWindow.tsx and app-store/appCatalog.ts.
import { registerLazyApp } from "../registry";

registerLazyApp("web-app", () =>
  import("./WebAppWindow").then((m) => ({ default: m.WebAppWindow })),
);
