"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useWindowContext } from "@/components/window-manager";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import type { TimeOffStatus } from "@/lib/staff/types";
import { DirectoryTab } from "./DirectoryTab";
import { InsightsTab } from "./InsightsTab";
import { OffboardedTab } from "./OffboardedTab";
import { ShiftRoster } from "./ShiftRoster";
import { useStaffNav } from "./staffNavStore";
import { TabActiveContext } from "./tabActive";
import { TimeOffTab } from "./TimeOffTab";

const PANEL = "flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden";

const TAB_LABEL: Record<string, string> = {
  directory: "Directory",
  shifts: "Shift roster",
  timeoff: "Time off",
  offboarded: "Offboarded",
  insights: "Insights",
};

/**
 * Root Staff Management window, registered as "staff" (see apps/index.ts).
 * Four sections over one shared roster: the Directory (the list every other
 * app reads people from), the Shift roster, Time off and Offboarded (people
 * removed from the roster, kept on file). The data lives in
 * `@/lib/staff/staffStore`, mirrored from the server's files.
 */
export function StaffApp({ windowId }: { windowId: string }) {
  useStaffSync();
  const [tab, setTab] = useState("directory");
  useWindowContext(windowId, TAB_LABEL[tab] ?? null);
  const [timeOffStatus, setTimeOffStatus] = useState<TimeOffStatus | "">("");
  const openRequest = useStaffNav((s) => s.openRequest);
  const clearOpenRequest = useStaffNav((s) => s.clearOpenRequest);
  useEffect(() => {
    if (!openRequest) return;
    setTab(openRequest.tab);
    if (openRequest.timeOffStatus !== undefined)
      setTimeOffStatus(openRequest.timeOffStatus);
    clearOpenRequest(openRequest.id);
  }, [openRequest, clearOpenRequest]);
  const people = useStaffStore((s) => s.employees.length);
  const left = useStaffStore((s) => s.offboarded.length);
  const pending = useStaffStore(
    (s) => s.timeOff.filter((r) => r.status === "pending").length,
  );

  return (
    <div data-window-id={windowId} className="@container flex h-full w-full flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center px-5 pt-1 pb-3">
          <TabsList aria-label="Staff sections">
            <TabsTrigger value="directory" count={people}>
              Directory
            </TabsTrigger>
            <TabsTrigger value="shifts">Shift roster</TabsTrigger>
            <TabsTrigger value="timeoff" count={pending > 0 ? pending : undefined}>
              Time off
            </TabsTrigger>
            <TabsTrigger value="offboarded" count={left > 0 ? left : undefined}>
              Offboarded
            </TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="directory" forceMount className={PANEL}>
          <DirectoryTab />
        </TabsContent>
        <TabsContent value="shifts" forceMount className={PANEL}>
          <TabActiveContext value={tab === "shifts"}>
            <ShiftRoster />
          </TabActiveContext>
        </TabsContent>
        <TabsContent value="timeoff" forceMount className={PANEL}>
          <TabActiveContext value={tab === "timeoff"}>
            <TimeOffTab status={timeOffStatus} onStatusChange={setTimeOffStatus} />
          </TabActiveContext>
        </TabsContent>
        <TabsContent value="offboarded" forceMount className={PANEL}>
          <TabActiveContext value={tab === "offboarded"}>
            <OffboardedTab />
          </TabActiveContext>
        </TabsContent>
        <TabsContent value="insights" forceMount className={PANEL}>
          <TabActiveContext value={tab === "insights"}>
            <InsightsTab />
          </TabActiveContext>
        </TabsContent>
      </Tabs>
    </div>
  );
}
