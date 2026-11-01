"use client";

import { useEffect, useState } from "react";
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
          title="How you use AI OS"
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
      <Section title="Start up and focus">
        <Row
          title="Repeating to-dos create the next one"
          hint="When you close a repeating to-do, the next round is created at once (with an Undo). Off: you are asked."
        >
          <Switch
            checked={autoRecur}
            onCheckedChange={setAutoRecur}
            aria-label="Repeating to-dos create the next one"
          />
        </Row>
        <Row
          title="Who's out today on the desktop"
          hint="A small card behind your windows."
        >
          <Switch
            checked={desktopWidget}
            onCheckedChange={setDesktopWidget}
            aria-label="Who's out today on the desktop"
          />
        </Row>
        <Row title="Skip the lock screen" hint="Open straight to the desktop.">
          <Switch
            checked={instantUnlock}
            onCheckedChange={setInstantUnlock}
            aria-label="Skip the lock screen"
          />
        </Row>
        <Row
          title="Show what needs you on the lock screen"
          hint="A line under the clock: how many things need you and what they are."
        >
          <Switch
            checked={lockSummary}
            onCheckedChange={setLockSummary}
            aria-label="Show what needs you on the lock screen"
          />
        </Row>
        <Row
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

      <Section title="The command bar asks first">
        {CONFIRM_KEYS.map((key) => (
          <Row
            key={key}
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

      <Section title="Command history">
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
    <Section title="Everything shown this session">
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
  useWindowContext(windowId, TAB_LABELS[tab]);
  const request = useSettingsNav((s) => s.request);
  useEffect(() => {
    if (!request) return;
    setTab(request.tab);
    useSettingsNav.getState().clear(request.id);
  }, [request]);

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SettingsTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-6 pt-1 pb-3">
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
            <TabsTrigger value="accessibility">Accessibility</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="help">Help</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="mx-auto max-w-2xl">
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
              <ActivityTab />
            </TabsContent>
            <TabsContent value="help">
              <HelpTab />
            </TabsContent>
            <TabsContent value="about">
              <AboutTab />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
