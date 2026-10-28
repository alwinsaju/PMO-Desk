"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import { DirectoryTab } from "./DirectoryTab";
import { OffboardedTab } from "./OffboardedTab";
import { ShiftRoster } from "./ShiftRoster";
import { TimeOffTab } from "./TimeOffTab";

const PANEL = "flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden";

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
          </TabsList>
        </div>
        <TabsContent value="directory" forceMount className={PANEL}>
          <DirectoryTab />
        </TabsContent>
        <TabsContent value="shifts" forceMount className={PANEL}>
          <ShiftRoster />
        </TabsContent>
        <TabsContent value="timeoff" forceMount className={PANEL}>
          <TimeOffTab />
        </TabsContent>
        <TabsContent value="offboarded" forceMount className={PANEL}>
          <OffboardedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
