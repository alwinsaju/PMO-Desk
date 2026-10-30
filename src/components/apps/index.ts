// Side-effect import barrel for app registration.
//
// Every app package (files-app, notes-app, browser-app, app-store, ...)
// registers itself by calling `registerApp(appId, Component)` from
// `./registry` somewhere in its own module. That call only actually runs
// once this module is imported, so each app package adds ONE side-effect
// import line here. Order doesn't matter, and nothing needs to be exported
// from this file — `Window.tsx` never imports app components directly, it
// only calls `getAppComponent(appId)` from `./registry`.
//
// This file is imported once, for its side effects, from
// src/components/window-manager/WindowManager.tsx — NOT from Desktop.tsx.
// See ARCHITECTURE.md's "The app registry" gotcha for why that distinction
// matters.
//
import "./notes-app";
import "./files-app";
import "./browser-app";
import "./tasks-app";
// PMO To-Do registers lazily from here so its code is not in the first bundle.
import { registerLazyApp } from "./registry";
import { REGISTER_IDS } from "@/lib/registers/defs";
import "./web-app"; // generic window every REAL App Store catalog entry opens into
import "../app-store"; // the App Store is also opened as a window

registerLazyApp("pmo-todo", () =>
  import("./pmo-todo-app/PmoTodoApp").then((m) => ({ default: m.PmoTodoApp })),
);
registerLazyApp("staff", () =>
  import("./staff-app/StaffApp").then((m) => ({ default: m.StaffApp })),
);
registerLazyApp("templates", () =>
  import("./templates-app/TemplatesApp").then((m) => ({ default: m.TemplatesApp })),
);
registerLazyApp("dashboard", () =>
  import("./dashboard-app/DashboardApp").then((m) => ({ default: m.DashboardApp })),
);
registerLazyApp("settings", () =>
  import("./settings-app/SettingsApp").then((m) => ({ default: m.SettingsApp })),
);
registerLazyApp("pmo-toolkit", () =>
  import("./toolkit/ToolkitApp").then((m) => ({ default: m.ToolkitApp })),
);
// Each PMO tool is its own window, registered under its own id.
for (const id of REGISTER_IDS) {
  registerLazyApp(id, () =>
    import("./toolkit/tools").then((m) => ({ default: m.toolComponent(id) })),
  );
}
