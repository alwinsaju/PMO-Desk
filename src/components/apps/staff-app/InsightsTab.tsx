"use client";

import { useState, type ComponentType } from "react";
import {
  ArrowsLeftRightIcon,
  CalendarDotsIcon,
  DownloadSimpleIcon,
  HourglassMediumIcon,
  ListChecksIcon,
  PhoneCallIcon,
  SparkleIcon,
  SquaresFourIcon,
  TreeStructureIcon,
  UsersIcon,
  type IconProps,
} from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CapacityPanel } from "./CapacityPanel";
import {
  BalancesPanel,
  ExportPanel,
  HolidaysPanel,
  OnCallPanel,
  SwapsPanel,
} from "./PlanningPanels";
import { ChecklistsPanel, OrgPanel, PeoplePanel, SkillsPanel } from "./PeoplePanels";
import { useElementWidth } from "./useElementWidth";

type Section = readonly [id: string, label: string, icon: ComponentType<IconProps>];

const GROUPS: readonly { title: string; sections: readonly Section[] }[] = [
  {
    title: "Planning",
    sections: [
      ["capacity", "Capacity", SquaresFourIcon],
      ["balances", "Leave balances", HourglassMediumIcon],
      ["swaps", "Swaps", ArrowsLeftRightIcon],
      ["oncall", "On call", PhoneCallIcon],
      ["holidays", "Holidays", CalendarDotsIcon],
    ],
  },
  {
    title: "People",
    sections: [
      ["people", "People", UsersIcon],
      ["skills", "Skills", SparkleIcon],
      ["org", "Org chart", TreeStructureIcon],
      ["checklists", "Checklists", ListChecksIcon],
    ],
  },
  { title: "Data", sections: [["export", "Export", DownloadSimpleIcon]] },
];

/** From this width the sections are a left-hand list; narrower they are a row of pills. */
const SIDE_NAV_MIN = 760;

/** Planning and people insights over the roster, time off and directory. */
export function InsightsTab() {
  const [section, setSection] = useState<string>("capacity");
  const [areaRef, width] = useElementWidth();
  const side = width >= SIDE_NAV_MIN;
  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={section}
        onValueChange={setSection}
        orientation={side ? "vertical" : "horizontal"}
        className={cn("flex min-h-0 flex-1", side ? "flex-row" : "flex-col")}
      >
        <div
          className={
            side
              ? "scroll-thin border-line w-[208px] shrink-0 overflow-y-auto border-r px-3 pb-4"
              : "scroll-thin max-w-full overflow-x-auto px-5 pb-3"
          }
        >
          <TabsList
            aria-label="Insights"
            className={cn(
              side && "flex w-full flex-col items-stretch gap-0.5 bg-transparent p-0",
            )}
          >
            {GROUPS.map((group, groupIndex) => (
              <div
                key={group.title}
                role="presentation"
                className={side ? "flex flex-col gap-0.5" : "contents"}
              >
                {side && (
                  <span
                    aria-hidden
                    className={cn(
                      "text-ink-muted px-3 pb-1 text-[11px] font-bold tracking-[0.08em] uppercase",
                      groupIndex > 0 && "pt-3",
                    )}
                  >
                    {group.title}
                  </span>
                )}
                {group.sections.map(([id, label, Icon]) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className={cn(
                      "shrink-0 whitespace-nowrap",
                      side &&
                        "data-[state=active]:bg-accent-soft data-[state=active]:text-accent-ink w-full justify-start gap-2.5 px-3 data-[state=active]:shadow-none",
                    )}
                  >
                    {side && <Icon size={16} weight="bold" aria-hidden />}
                    {label}
                  </TabsTrigger>
                ))}
              </div>
            ))}
          </TabsList>
        </div>
        <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-6">
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
    </div>
  );
}
