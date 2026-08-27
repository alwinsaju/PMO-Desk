/**
 * Plain, framework-agnostic metadata for the browser's mock pages. No live
 * component values live here — the actual page content is authored as
 * plain React in HomePage.tsx/WikiPage.tsx/AboutPage.tsx, and BrowserApp.tsx
 * is the one place that switches an id to a component. Keeping this file
 * component-free means it never needs "use client" itself, same split as
 * `files-app/mockFileSystem.ts` and `notes-app/mockNotesStore.ts`.
 */

export type MockPageId = "home" | "wiki" | "about";

export interface MockPageMeta {
  /** Shown in the address bar — a fake URL, not a real one. */
  url: string;
}

export const mockPageMeta: Record<MockPageId, MockPageMeta> = {
  home: { url: "pathfinder://home" },
  wiki: { url: "pathfinder://wiki/window-managers" },
  about: { url: "pathfinder://about" },
};

export const initialMockPage: MockPageId = "home";
