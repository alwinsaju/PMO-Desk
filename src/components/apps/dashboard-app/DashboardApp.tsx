"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowsClockwiseIcon,
  CameraIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { useDashboardPrefs } from "@/lib/dashboard/dashboardPrefsStore";
import { exportElement } from "@/lib/dashboard/exportView";
import {
  agingBuckets,
  reportHealth,
  signoffPipeline,
  todayList,
  weekOverWeek,
  workloadByOwner,
} from "@/lib/dashboard/insights";
import {
  DEFAULT_LAYOUT,
  WIDGET_TITLE,
  moveWidget,
  saveLayout,
  toggleHidden,
  toggleWide,
  visibleWidgets,
  type WidgetId,
} from "@/lib/dashboard/layout";
import { awayWindow, openTodos, overdueChasers } from "@/lib/dashboard/summary";
import { updatedLabel } from "@/lib/dashboard/updatedLabel";
import { toast } from "@/lib/notifications/toastStore";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { localParts } from "@/lib/pmo/due";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { dayName, formatDate, todayIso } from "@/lib/staff/dates";
import { peopleAway, whosOff } from "@/lib/staff/whosOff";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import {
  CONTENT_WIDTH,
  GUTTER_X,
  Note,
  PanelMessage,
  ScrollBody,
} from "../pmo-todo-app/parts";
import { reviewCount } from "../pmo-todo-app/queueView";
import { usePmoData } from "../pmo-todo-app/usePmoData";
import { useStaffNav } from "../staff-app/staffNavStore";
import { useTasksNav } from "../tasks-app/tasksNavStore";
import {
  AgingWidget,
  HealthWidget,
  PipelineWidget,
  TodayWidget,
  WeekWidget,
  WorkloadWidget,
} from "./InsightWidgets";
import { StaffAttentionWidget } from "./StaffAttentionWidget";
import { RegistersWidget } from "./RegistersWidget";
import { useNow, useReportStatuses, useRoster } from "./useDashboardData";
import { ChasersWidget, OpenTodosWidget, ReportsWidget, WhosOutWidget } from "./widgets";

/**
 * Root Dashboard window, registered as "dashboard" (see apps/index.ts): one screen
 * that answers "what needs me today?" from the apps that hold the answer. It reads
 * the PMO to-dos, the Tasks engine, the saved weekly reports and the Staff roster
 * and changes nothing itself; each card opens the app behind it. The cards can be
 * hidden, reordered and widened, saved as named layouts, and the screen exported as
 * a picture or PDF in the desktop app.
 */
export function DashboardApp({ windowId }: { windowId: string }) {
  const { state, connection, refetch } = usePmoData();
  useStaffSync();
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const shifts = useStaffStore((s) => s.shifts);
  const staffStatus = useStaffStore((s) => s.status);
  const roster = useRoster();
  const now = useNow();
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const period = usePreferences((s) => s.dashboardPeriod);
  const setPeriod = usePreferences((s) => s.setDashboardPeriod);
  const layout = useDashboardPrefs((s) => s.layout);
  const layouts = useDashboardPrefs((s) => s.layouts);
  const updatePrefs = useDashboardPrefs((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const captureRef = useRef<HTMLDivElement>(null);

  const prefs = state?.config.reminders;
  const timeZone = prefs?.timeZone ?? "Asia/Kolkata";
  const reports = useReportStatuses(now, timeZone);
  const today = prefs ? localParts(now, prefs.timeZone).day : todayIso(now);

  const todos = useMemo(
    () => (state && prefs ? openTodos(state.todos, now, prefs) : null),
    [state, prefs, now],
  );
  const chasers = useMemo(
    () => (state && prefs ? overdueChasers(state.todos, now, prefs) : []),
    [state, prefs, now],
  );
  const away = useMemo(() => {
    const range = awayWindow(today, period);
    return whosOff({
      ...range,
      employees,
      timeOff,
      shifts,
      members: roster.members,
      events: roster.events,
      includePending: true,
    });
  }, [today, period, employees, timeOff, shifts, roster]);
  const awayToday = useMemo(
    () =>
      peopleAway(
        whosOff({
          from: today,
          to: today,
          employees,
          timeOff,
          shifts,
          members: roster.members,
          events: roster.events,
        }),
      ),
    [today, employees, timeOff, shifts, roster],
  );

  const insights = useMemo(() => {
    if (!state || !prefs) return null;
    const needing = (reports.rows ?? []).filter((r) => r.needsYou).map((r) => r.name);
    return {
      today: todayList({
        todos: state.todos,
        today,
        now,
        prefs,
        pendingLeave: timeOff.filter((r) => r.status === "pending").length,
        reviewCount: reviewCount(state.queue),
        tasksNeedingYou: needing,
        awayToday,
      }),
      workload: workloadByOwner(state.todos, today),
      aging: agingBuckets(state.todos, now),
      pipeline: signoffPipeline(state.todos, now, prefs),
      health: reportHealth(reports.rows ?? [], reports.histories),
      week: weekOverWeek({
        todos: state.todos,
        runs: Object.values(reports.histories).flatMap((h) => [...(h ?? [])]),
        leave: timeOff,
        today,
        timeZone,
      }),
    };
  }, [state, prefs, today, now, timeOff, awayToday, reports, timeZone]);

  const openApp = (appId: string) => () => {
    openOrFocusBuiltInApp(appId);
  };
  const refresh = () => {
    refetch();
    setUpdatedAt(new Date());
  };
  const openStaffTimeOff = () => {
    useStaffNav.getState().requestOpen({ tab: "timeoff", timeOffStatus: "" });
    openOrFocusBuiltInApp("staff");
  };
  const viewTaskLog = (taskId: string) => {
    useTasksNav.getState().requestDetail(taskId);
    openOrFocusBuiltInApp("tasks");
  };

  const exportAs = async (format: "png" | "pdf") => {
    const el = captureRef.current;
    if (!el) return;
    const saved = await exportElement(el, format, `dashboard-${today}`);
    if (saved) toast({ tone: "success", message: `Saved ${saved}` });
  };

  const cards: Record<WidgetId, ReactNode> = {
    today: insights && (
      <TodayWidget
        items={insights.today}
        onOpen={(appId) => openOrFocusBuiltInApp(appId)}
      />
    ),
    todos:
      todos && prefs ? (
        <OpenTodosWidget summary={todos} today={today} onOpen={openApp("pmo-todo")} />
      ) : null,
    chasers:
      todos && prefs ? (
        <ChasersWidget rows={chasers} onOpen={openApp("pmo-todo")} />
      ) : null,
    reports: (
      <ReportsWidget
        rows={reports.rows}
        engineUp={reports.engineUp}
        onOpenTasks={openApp("tasks")}
        onViewLog={viewTaskLog}
      />
    ),
    staff: (
      <StaffAttentionWidget
        onOpen={() => {
          useStaffNav.getState().requestOpen({ tab: "insights" });
          openOrFocusBuiltInApp("staff");
        }}
      />
    ),
    away: (
      <WhosOutWidget
        result={away}
        period={period}
        onPeriod={setPeriod}
        today={today}
        onOpen={openStaffTimeOff}
        status={
          staffStatus === "ready"
            ? "ready"
            : staffStatus === "offline"
              ? "offline"
              : "loading"
        }
      />
    ),
    workload: insights && <WorkloadWidget rows={insights.workload} />,
    aging: insights && <AgingWidget buckets={insights.aging} />,
    signoff: insights && <PipelineWidget pipeline={insights.pipeline} />,
    health: insights && <HealthWidget health={insights.health} />,
    week: insights && <WeekWidget week={insights.week} />,
    registers: <RegistersWidget onOpen={(toolId) => openOrFocusBuiltInApp(toolId)} />,
  };

  const shown = visibleWidgets(layout).filter((id) => cards[id]);
  const canExport = Boolean(getDesktopBridge()?.view);

  return (
    <div data-window-id={windowId} className="@container flex h-full w-full flex-col">
      <ScrollBody memoryKey="dashboard">
        <div
          ref={captureRef}
          className={`${CONTENT_WIDTH} ${GUTTER_X} flex flex-col gap-4 pt-1 pb-6`}
        >
          <header className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-ink text-[20px] font-bold tracking-[-0.01em]">
                Dashboard
              </h1>
              <p className="text-ink-muted text-[13px]">
                {dayName(today)} {formatDate(today)}
                <span role="status"> · {updatedLabel(updatedAt, now)}</span>
              </p>
            </div>
            <Button
              variant={editing ? "secondary" : "outline"}
              size="sm"
              onClick={() => setEditing((e) => !e)}
              aria-pressed={editing}
            >
              <SlidersHorizontalIcon size={14} />
              Customise
            </Button>
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => void exportAs("png")}>
                  <CameraIcon size={14} />
                  PNG
                </Button>
                <Button variant="outline" size="sm" onClick={() => void exportAs("pdf")}>
                  PDF
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Refresh">
              <ArrowsClockwiseIcon size={14} />
              Refresh
            </Button>
          </header>

          {editing && (
            <section
              aria-label="Customise the Dashboard"
              data-testid="customise"
              className="border-line bg-card rounded-card flex flex-col gap-3 border p-4"
            >
              <ul className="flex flex-col gap-1.5">
                {layout.order.map((id) => {
                  const hidden = layout.hidden.includes(id);
                  return (
                    <li
                      key={id}
                      className="flex flex-wrap items-center gap-3 text-[13px]"
                    >
                      <label className="text-ink flex min-w-44 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!hidden}
                          onChange={() =>
                            updatePrefs((p) => ({
                              ...p,
                              layout: toggleHidden(p.layout, id),
                            }))
                          }
                          className="accent-accent h-4 w-4"
                          aria-label={`Show ${WIDGET_TITLE[id]}`}
                        />
                        {WIDGET_TITLE[id]}
                      </label>
                      {!hidden && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${WIDGET_TITLE[id]} up`}
                            onClick={() =>
                              updatePrefs((p) => ({
                                ...p,
                                layout: moveWidget(p.layout, id, -1),
                              }))
                            }
                          >
                            Up
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${WIDGET_TITLE[id]} down`}
                            onClick={() =>
                              updatePrefs((p) => ({
                                ...p,
                                layout: moveWidget(p.layout, id, 1),
                              }))
                            }
                          >
                            Down
                          </Button>
                          <label className="text-ink-soft flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={layout.wide.includes(id)}
                              onChange={() =>
                                updatePrefs((p) => ({
                                  ...p,
                                  layout: toggleWide(p.layout, id),
                                }))
                              }
                              className="accent-accent h-4 w-4"
                              aria-label={`Wide ${WIDGET_TITLE[id]}`}
                            />
                            Wide
                          </label>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="border-line flex flex-wrap items-center gap-2 border-t pt-3">
                <Input
                  aria-label="Layout name"
                  placeholder="Name this layout"
                  {...noSpellcheck}
                  className="w-44"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!layoutName.trim()}
                  onClick={() => {
                    updatePrefs((p) => ({
                      ...p,
                      layouts: saveLayout(p.layouts, layoutName, p.layout),
                    }));
                    setLayoutName("");
                  }}
                >
                  Save layout
                </Button>
                {layouts.map((l) => (
                  <Button
                    key={l.name}
                    size="sm"
                    variant="outline"
                    onClick={() => updatePrefs((p) => ({ ...p, layout: l.layout }))}
                  >
                    {l.name}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => updatePrefs((p) => ({ ...p, layout: DEFAULT_LAYOUT }))}
                >
                  Reset
                </Button>
              </div>
              <BriefingSettings />
            </section>
          )}

          {connection === "offline" && !state && (
            <Note tone="warning" role="alert">
              Can’t reach the AI OS server, so to-dos are not shown. Staff and report
              cards may still update.
            </Note>
          )}

          {!state && connection === "loading" ? (
            <PanelMessage>Loading your dashboard…</PanelMessage>
          ) : (
            <div
              className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-2"
              data-testid="dashboard-grid"
            >
              {shown.map((id) => (
                <div
                  key={id}
                  className={layout.wide.includes(id) ? "@3xl:col-span-2" : ""}
                >
                  {cards[id]}
                </div>
              ))}
              {shown.length === 0 && (
                <PanelMessage>
                  Every card is hidden. Use Customise to show some.
                </PanelMessage>
              )}
            </div>
          )}
        </div>
      </ScrollBody>
    </div>
  );
}

/** The morning briefing: on or off, and the time after which it shows once a day. */
function BriefingSettings() {
  const enabled = useDashboardPrefs((s) => s.briefingEnabled);
  const time = useDashboardPrefs((s) => s.briefingTime);
  const update = useDashboardPrefs((s) => s.update);
  return (
    <div className="border-line flex flex-wrap items-center gap-3 border-t pt-3 text-[13px]">
      <label className="text-ink-soft flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => update((p) => ({ ...p, briefingEnabled: e.target.checked }))}
          className="accent-accent h-4 w-4"
        />
        Morning briefing at
      </label>
      <input
        type="time"
        aria-label="Briefing time"
        value={time}
        disabled={!enabled}
        onChange={(e) =>
          e.target.value && update((p) => ({ ...p, briefingTime: e.target.value }))
        }
        className="rounded-control border-line bg-surface-elevated h-9 border px-2.5 text-[13px]"
      />
      <span className="text-ink-muted text-[12px]">
        Shown once a day while AI OS is open: what needs you, who is out, tasks waiting.
      </span>
    </div>
  );
}
