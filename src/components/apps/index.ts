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
// PMO To-Do registers lazily from here (not via ./pmo-todo-app/index.ts, which
// stays an unused eager registration) so its code is not in the first bundle.
import { registerLazyApp } from "./registry";
import "./web-app"; // generic window every REAL App Store catalog entry opens into
import "../app-store"; // the App Store is also opened as a window

registerLazyApp("pmo-todo", () =>
  import("./pmo-todo-app/PmoTodoApp").then((m) => ({ default: m.PmoTodoApp })),
);
