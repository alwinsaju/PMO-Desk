"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { CapacityPanel } from "./CapacityPanel";
import {
  BalancesPanel,
  ExportPanel,
  HolidaysPanel,
  OnCallPanel,
  SwapsPanel,
} from "./PlanningPanels";
import { ChecklistsPanel, OrgPanel, PeoplePanel, SkillsPanel } from "./PeoplePanels";

const SECTIONS = [
  ["capacity", "Capacity"],
  ["people", "People"],
  ["balances", "Leave balances"],
  ["swaps", "Swaps"],
  ["oncall", "On call"],
  ["skills", "Skills"],
  ["org", "Org chart"],
  ["checklists", "Checklists"],
  ["holidays", "Holidays"],
  ["export", "Export"],
] as const;

/** Planning and people insights over the roster, time off and directory. */
export function InsightsTab() {
  const [section, setSection] = useState<string>("capacity");
  return (
    <Tabs
      value={section}
      onValueChange={setSection}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="scroll-thin max-w-full overflow-x-auto px-5 pb-3">
        <TabsList aria-label="Insights">
          {SECTIONS.map(([id, label]) => (
            <TabsTrigger key={id} value={id} className="shrink-0 whitespace-nowrap">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <TabsContent value="capacity">
          <CapacityPanel />
        </TabsContent>
        <TabsContent value="people">
          <PeoplePanel />
        </TabsContent>
        <TabsContent value="balances">
          <BalancesPanel />
        </TabsContent>
        <TabsContent value="swaps">
          <SwapsPanel />
        </TabsContent>
        <TabsContent value="oncall">
          <OnCallPanel />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsPanel />
        </TabsContent>
        <TabsContent value="org">
          <OrgPanel />
        </TabsContent>
        <TabsContent
          value="checklists"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <ChecklistsPanel />
        </TabsContent>
        <TabsContent value="holidays">
          <HolidaysPanel />
        </TabsContent>
        <TabsContent value="export">
          <ExportPanel />
        </TabsContent>
      </div>
    </Tabs>
  );
}
