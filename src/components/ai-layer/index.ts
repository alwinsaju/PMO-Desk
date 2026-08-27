// Public surface of the AI Agent Layer. Desktop.tsx mounts these four
// components directly. Everything else in this directory (agentStore,
// AgentStatusBadge, TaskList/TaskListItem, types, constants) is an
// internal implementation detail consumed only from within this package
// — import those via their own relative paths from inside ai-layer/*, not
// through this barrel (mirrors how src/components/taskbar/index.ts holds
// back DockTile).

export { CommandBar } from "./CommandBar";
export { AICursor } from "./AICursor";
export { AIAnnotationBubble } from "./AIAnnotationBubble";
export { PresenceAvatars } from "./PresenceAvatars";
