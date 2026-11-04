"use client";

import type { ComponentType } from "react";
import { CapacityGrid } from "./CapacityGrid";
import { RegisterApp } from "./RegisterApp";
import { TimesheetApp } from "./TimesheetApp";

/** `startAdding` opens the tool's Add dialog on mount. Timesheets has no Add dialog and ignores it. */
type ToolProps = { windowId: string; startAdding?: boolean };

const cache = new Map<string, ComponentType<ToolProps>>();

/** The window component for one PMO tool: its own screen where it has one, else the register list. */
export function toolComponent(id: string): ComponentType<ToolProps> {
  let component = cache.get(id);
  if (!component) {
    if (id === "timesheets") component = TimesheetApp;
    else {
      const Tool = ({ windowId, startAdding }: ToolProps) => (
        <RegisterApp
          defId={id}
          windowId={windowId}
          startAdding={startAdding}
          renderTop={id === "capacity" ? CapacityGrid : undefined}
        />
      );
      Tool.displayName = `Tool(${id})`;
      component = Tool;
    }
    cache.set(id, component);
  }
  return component;
}
