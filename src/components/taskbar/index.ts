// Public surface of the taskbar (dock) feature. Other code — Desktop.tsx,
// the desktop icon grid — should import from here rather than reaching into
// DockTile.tsx directly, which is an internal implementation detail of how
// one dock tile renders itself.

export { Dock } from "./Dock";
export { pinnedApps, pinnedAppIcons } from "./pinnedApps";
export type { PinnedApp } from "./pinnedApps";
