"use client";

import { useState } from "react";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { APP_HELP, GENERAL_HELP } from "@/lib/platform/appHelp";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { useTour } from "@/lib/platform/tourStore";
import { loadSampleData, removeSampleData } from "./sampleActions";
import { Note, Row, Section } from "./SettingsParts";

/** Settings > Help: the tour, sample data to try things on, and three common tasks per app. */
export function HelpTab() {
  const sampleLoaded = usePlatformPrefs((s) => s.sampleLoaded);
  const startTour = useTour((s) => s.start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "load" | "remove") => {
    setBusy(true);
    setError(null);
    const reply = action === "load" ? await loadSampleData() : await removeSampleData();
    setBusy(false);
    if (!reply.ok) {
      setError(reply.reason);
      return;
    }
    usePlatformPrefs
      .getState()
      .update((p) => ({ ...p, sampleLoaded: action === "load" }));
    toast({
      tone: "success",
      message:
        action === "load"
          ? `Added ${reply.todos} sample to-dos and ${reply.people} sample people.`
          : `Removed ${reply.todos} sample to-dos and ${reply.people} sample people.`,
    });
  };

  return (
    <>
      <Section title="Get started">
        <Row
          settingId="guided-tour"
          title="Guided tour"
          hint="A one-minute walk through the main apps."
        >
          <Button size="sm" onClick={startTour}>
            Start the tour
          </Button>
        </Row>
        <Row
          settingId="sample-data"
          title="Sample data"
          hint="Adds a few made-up to-dos, people and leave so every app has something to show. Only those records are removed again."
        >
          {sampleLoaded ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run("remove")}
            >
              {busy ? "Removing…" : "Remove sample data"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run("load")}
            >
              {busy ? "Adding…" : "Add sample data"}
            </Button>
          )}
        </Row>
        {error && (
          <Note tone="error" detail={error}>
            {error}
          </Note>
        )}
        <ul className="text-ink-muted mt-3 list-disc space-y-1 pl-5 text-[12.5px]">
          {GENERAL_HELP.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section title="Help for each app" settingId="app-help">
        <div className="divide-line divide-y">
          {APP_HELP.map((help) => (
            <details key={help.appId} className="py-2" data-testid={`help-${help.appId}`}>
              <summary className="text-ink cursor-pointer text-[14px] font-semibold">
                {help.title}
              </summary>
              <p className="text-ink-muted mt-2 text-[13px]">{help.summary}</p>
              <ol className="mt-3 space-y-3">
                {help.tasks.map((task) => (
                  <li key={task.title}>
                    <p className="text-ink text-[13px] font-semibold">{task.title}</p>
                    <ol className="text-ink-soft mt-1 list-decimal pl-5 text-[13px]">
                      {task.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
              {help.appId !== "settings" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => openOrFocusBuiltInApp(help.appId)}
                >
                  Open {help.title}
                </Button>
              )}
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
