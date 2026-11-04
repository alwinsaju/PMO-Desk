"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useWindowContext } from "@/components/window-manager";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { useFocusActive, useFocusMode } from "@/lib/focusModeStore";
import { remainingText } from "@/lib/focusMode";
import { toast, useToasts } from "@/lib/notifications/toastStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { CONFIRM_KEYS, type ConfirmKey } from "@/lib/preferences/schema";
import { filterShortcuts } from "@/lib/shortcuts";
import { cn } from "@/lib/cn";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useSettingsNav, type SettingsTab } from "./settingsNav";
import { ActivityTab } from "./ActivityTab";
import { AboutTab } from "./AboutTab";
import { DataTab } from "./DataTab";
import { HelpTab } from "./HelpTab";
import { Row, Section, when } from "./SettingsParts";
import { SettingsSearchBox, SettingsSearchResults } from "./SettingsSearch";
import { useDashboardPrefs } from "@/lib/dashboard/dashboardPrefsStore";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import {
  PROFILES,
  PROFILE_IDS,
  layoutAfterSwitch,
  sanitizeProfile,
  type ProfileId,
} from "@/lib/platform/profile";

const CONFIRM_LABEL: Record<ConfirmKey, string> = {
  create_todo: "Creating a to-do from the command bar",
  todo_done: "Marking a to-do done from the command bar",
  todo_snooze: "Snoozing a to-do from the command bar",
};

function General() {
  const profile = usePlatformPrefs((s) => s.profile);
  const switchProfile = (next: ProfileId) => {
    const dashboard = useDashboardPrefs.getState();
    const { layout, kept } = layoutAfterSwitch(dashboard.layout, profile, next);
    if (!kept) dashboard.update((p) => ({ ...p, layout }));
    usePlatformPrefs.getState().update((p) => ({ ...p, profile: next }));
    toast({
      tone: "info",
      message: kept
        ? `Switched to ${PROFILES[next].label}. Your customised Dashboard was kept.`
        : `Switched to ${PROFILES[next].label}. The Dashboard now shows its cards.`,
    });
  };
  const instantUnlock = usePreferences((s) => s.instantUnlock);
  const desktopWidget = usePreferences((s) => s.desktopWidget);
  const autoRecur = usePreferences((s) => s.autoRecur);
  const setAutoRecur = usePreferences((s) => s.setAutoRecur);
  const setDesktopWidget = usePreferences((s) => s.setDesktopWidget);
  const setInstantUnlock = usePreferences((s) => s.setInstantUnlock);
  const lockSummary = usePreferences((s) => s.lockSummary);
  const setLockSummary = usePreferences((s) => s.setLockSummary);
  const confirmActions = usePreferences((s) => s.confirmActions);
  const setConfirmAction = usePreferences((s) => s.setConfirmAction);
  const log = usePreferences((s) => s.commandLog);
  const clearLog = usePreferences((s) => s.clearCommandLog);
  const until = useFocusMode((s) => s.until);
  const focusOn = useFocusActive();
  const startFocus = useFocusMode((s) => s.start);
  const stopFocus = useFocusMode((s) => s.stop);
  return (
    <>
      <Section title="Profile">
        <Row
          settingId="profile"
          title="How you use PMO Desk"
          hint={`${PROFILES[profile].hint} This is a convenience, not a lock: you can switch any time.`}
        >
          <select
            value={profile}
            onChange={(e) => switchProfile(sanitizeProfile(e.target.value))}
            aria-label="Profile"
            className="border-line bg-chip text-ink rounded-control border px-2 py-1.5 text-[13px]"
          >
            {PROFILE_IDS.map((id) => (
              <option key={id} value={id}>
                {PROFILES[id].label}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section
        title="Lock screen and desktop"
        description="What you see when PMO Desk starts."
      >
        <Row
          settingId="desktop-widget"
          title="Who's out today on the desktop"
          hint="A small card behind your windows."
        >
          <Switch
            checked={desktopWidget}
            onCheckedChange={setDesktopWidget}
            aria-label="Who's out today on the desktop"
          />
        </Row>
        <Row
          settingId="instant-unlock"
          title="Skip the lock screen"
          hint="Open straight to the desktop."
        >
          <Switch
            checked={instantUnlock}
            onCheckedChange={setInstantUnlock}
            aria-label="Skip the lock screen"
          />
        </Row>
        <Row
          settingId="lock-summary"
          title="Show what needs you on the lock screen"
          hint="A line under the clock: how many things need you and what they are."
        >
          <Switch
            checked={lockSummary}
            onCheckedChange={setLockSummary}
            aria-label="Show what needs you on the lock screen"
          />
        </Row>
      </Section>
      <Section title="To-dos">
        <Row
          settingId="auto-recur"
          title="Repeating to-dos create the next one"
          hint="When you close a repeating to-do, the next round is created at once (with an Undo). Off: you are asked."
        >
          <Switch
            checked={autoRecur}
            onCheckedChange={setAutoRecur}
            aria-label="Repeating to-dos create the next one"
          />
        </Row>
      </Section>
      <Section title="Focus">
        <Row
          settingId="focus-mode"
          title="Focus mode"
          hint={
            focusOn
              ? remainingText(until, Date.now())
              : "Hide the dock and hold back notices for 25 minutes. Errors still show."
          }
        >
          <Switch
            checked={focusOn}
            onCheckedChange={(on) => (on ? startFocus() : stopFocus())}
            aria-label="Focus mode"
          />
        </Row>
      </Section>

      <Section
        title="The command bar asks first"
        description="Before it acts for you, the command bar can show an “Are you sure?” card."
      >
        {CONFIRM_KEYS.map((key) => (
          <Row
            key={key}
            settingId={`confirm-${key}`}
            title={CONFIRM_LABEL[key]}
            hint="Show an “Are you sure?” card before it happens."
          >
            <Switch
              checked={confirmActions[key]}
              onCheckedChange={(ask) => setConfirmAction(key, ask)}
              aria-label={CONFIRM_LABEL[key]}
            />
          </Row>
        ))}
        <p className="text-ink-muted pt-2 text-[12.5px]">
          Sending mail always needs your approval in Tasks; that is not a setting.
        </p>
      </Section>

      <Section title="Command history" settingId="command-history">
        {log.length === 0 ? (
          <p className="text-ink-muted py-2 text-[13px]">
            Nothing yet. What you ask the command bar is listed here.
          </p>
        ) : (
          <ul className="divide-line divide-y">
            {[...log]
              .reverse()
              .slice(0, 15)
              .map((entry) => (
                <li
                  key={`${entry.at}-${entry.prompt}`}
                  className="flex items-baseline gap-3 py-2 text-[13px]"
                >
                  <span className="text-ink-muted w-28 shrink-0 text-[12px]">
                    {when(entry.at)}
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate" title={entry.prompt}>
                    {entry.prompt}
                  </span>
                  <span className="text-ink-muted shrink-0 text-[12px]">
                    {entry.tool} · {entry.outcome}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {log.length > 0 && (
          <Button variant="outline" size="sm" className="mt-3" onClick={clearLog}>
            Clear history
          </Button>
        )}
      </Section>
    </>
  );
}

function Notifications() {
  const history = useToasts((s) => s.history);
  const clear = useToasts((s) => s.clearHistory);
  const items = [...history].reverse();
  return (
    <Section title="Everything shown this session" settingId="notification-history">
      {items.length === 0 ? (
        <p className="text-ink-muted py-2 text-[13px]">No notifications yet.</p>
      ) : (
        <>
          <ul className="divide-line divide-y">
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5 text-[13px]">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.tone === "danger"
                      ? "bg-red"
                      : n.tone === "warning"
                        ? "bg-amber"
                        : n.tone === "success"
                          ? "bg-success-dot"
                          : "bg-accent",
                  )}
                />
                <span className="text-ink min-w-0 flex-1 break-words">{n.message}</span>
                <span className="text-ink-muted shrink-0 text-[12px]">{when(n.at)}</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="mt-3" onClick={clear}>
            Clear list
          </Button>
        </>
      )}
    </Section>
  );
}

function Shortcuts() {
  const [query, setQuery] = useState("");
  const groups = filterShortcuts(query);
  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter shortcuts"
        data-setting-id="shortcut-list"
        {...noSpellcheck}
        placeholder="Filter shortcuts"
        className="border-line bg-chip text-ink rounded-control mb-4 w-full border px-3 py-2 text-[13.5px] outline-none"
      />
      {groups.length === 0 && (
        <p className="text-ink-muted text-[13px]">No shortcut matches.</p>
      )}
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.shortcuts.map((s) => (
            <div
              key={s.keys}
              className="border-line flex items-baseline gap-4 border-b py-2 last:border-b-0"
            >
              <kbd className="bg-chip text-ink rounded-control shrink-0 px-2 py-0.5 font-mono text-[12px]">
                {s.keys}
              </kbd>
              <span className="text-ink-soft text-[13.5px]">{s.action}</span>
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}

function Accessibility() {
  const reducedMotion = usePreferences((s) => s.reducedMotion);
  const highContrast = usePreferences((s) => s.highContrast);
  const setReducedMotion = usePreferences((s) => s.setReducedMotion);
  const setHighContrast = usePreferences((s) => s.setHighContrast);
  const colourBlindSafe = useStaffPrefs((s) => s.colourBlindSafe);
  return (
    <Section title="Display">
      <Row
        settingId="reduce-motion"
        title="Reduce motion"
        hint="No animation or easing. Also follows your computer's own setting."
      >
        <Switch
          checked={reducedMotion}
          onCheckedChange={setReducedMotion}
          aria-label="Reduce motion"
        />
      </Row>
      <Row
        settingId="high-contrast"
        title="High contrast"
        hint="Stronger text, clearer borders and a thick keyboard focus ring."
      >
        <Switch
          checked={highContrast}
          onCheckedChange={setHighContrast}
          aria-label="High contrast"
        />
      </Row>
      <Row
        settingId="colour-blind-roster"
        title="Colour-blind-safe roster"
        hint="The shift roster uses colours that stay apart for colour-blind readers, and each shift also gets a pattern."
      >
        <Switch
          checked={colourBlindSafe}
          onCheckedChange={(on) =>
            useStaffPrefs.getState().update((p) => ({ ...p, colourBlindSafe: on }))
          }
          aria-label="Colour-blind-safe roster"
        />
      </Row>
      <p className="text-ink-muted pt-3 text-[12.5px]">
        Every control can be used from the keyboard; press ? for the shortcut list.
      </p>
    </Section>
  );
}

const TAB_ORDER: readonly SettingsTab[] = [
  "general",
  "notifications",
  "shortcuts",
  "accessibility",
  "data",
  "activity",
  "help",
  "about",
];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  notifications: "Notifications",
  shortcuts: "Shortcuts",
  accessibility: "Accessibility",
  data: "Data",
  activity: "Activity",
  help: "Help",
  about: "About",
};

/** One place for the settings that were spread over menus: start up, focus, what the command bar
 *  asks first, its history, notifications, shortcuts and accessibility. */
export function SettingsApp({ windowId }: { windowId: string }) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<{ id: string; n: number } | null>(null);
  const [activitySince, setActivitySince] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== "";
  useWindowContext(windowId, TAB_LABELS[tab]);
  const request = useSettingsNav((s) => s.request);
  useEffect(() => {
    if (!request) return;
    setTab(request.tab);
    setQuery("");
    setActivitySince(request.tab === "activity" ? (request.activitySince ?? "") : "");
    useSettingsNav.getState().clear(request.id);
  }, [request]);

  // After a search result is chosen the tab has rendered: bring the row into view and flash it.
  useEffect(() => {
    if (!jump) return;
    let row: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      row =
        rootRef.current?.querySelector<HTMLElement>(`[data-setting-id="${jump.id}"]`) ??
        null;
      if (!row) return false;
      row.scrollIntoView({ block: "center" });
      row.dataset.flash = "true";
      timer = setTimeout(() => row && delete row.dataset.flash, 1800);
      return true;
    };
    const frame = show() ? 0 : requestAnimationFrame(show);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (row) delete row.dataset.flash;
    };
  }, [jump]);

  const goTo = (next: SettingsTab) => {
    setQuery("");
    if (next !== "activity") setActivitySince("");
    if (next !== "activity") setActivitySince("");
    setTab(next);
  };

  return (
    <div
      ref={rootRef}
      data-window-id={windowId}
      className="@container flex h-full w-full flex-col"
    >
      <div className="flex px-6 pt-1 pb-3">
        <SettingsSearchBox value={query} onChange={setQuery} />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => goTo(v as SettingsTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-6 pb-3">
          {/* Eight tabs only fit in a wide window; a narrow one gets a list instead of a sideways scroll. */}
          <TabsList aria-label="Settings sections" className="hidden @3xl:inline-flex">
            {TAB_ORDER.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
          <select
            value={tab}
            onChange={(e) => goTo(e.target.value as SettingsTab)}
            aria-label="Settings section"
            className="border-line bg-chip text-ink rounded-control w-full border px-3 py-2 text-[13.5px] font-semibold @3xl:hidden"
          >
            {TAB_ORDER.map((id) => (
              <option key={id} value={id}>
                {TAB_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="mx-auto max-w-2xl">
            {searching ? (
              <SettingsSearchResults
                query={query}
                onPick={(entry) => {
                  setQuery("");
                  setTab(entry.tab);
                  setJump((j) => ({ id: entry.id, n: (j?.n ?? 0) + 1 }));
                }}
              />
            ) : (
              <>
                <TabsContent value="general">
                  <General />
                </TabsContent>
                <TabsContent value="notifications">
                  <Notifications />
                </TabsContent>
                <TabsContent value="shortcuts">
                  <Shortcuts />
                </TabsContent>
                <TabsContent value="accessibility">
                  <Accessibility />
                </TabsContent>
                <TabsContent value="data">
                  <DataTab />
                </TabsContent>
                <TabsContent value="activity">
                  <ActivityTab
                    since={activitySince}
                    onShowAll={() => setActivitySince("")}
                  />
                </TabsContent>
                <TabsContent value="help">
                  <HelpTab />
                </TabsContent>
                <TabsContent value="about">
                  <AboutTab />
                </TabsContent>
              </>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
}
