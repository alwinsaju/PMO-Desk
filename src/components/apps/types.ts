import type { ComponentType } from "react";

/**
 * Contract every app in the registry must satisfy. An app receives only its
 * own `windowId` — everything else it needs (its own title, whether it's
 * focused, etc.) comes from `useWindowStore` selectors keyed off that id, or
 * from the app's own local/external state. Apps must NOT assume they are
 * the only instance of their kind — the same appId can be opened into
 * multiple windows at once, each with a different windowId.
 */
export type AppComponent = ComponentType<{ windowId: string }>;
