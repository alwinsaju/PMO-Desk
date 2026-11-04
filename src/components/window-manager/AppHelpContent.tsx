"use client";

import type { AppHelp } from "@/lib/platform/appHelp";

/** One app's help: what it is for and its three common tasks. Shared by the Help button in a
 *  window's title bar and by Settings > Help, so the two never drift apart. */
export function AppHelpContent({ help }: { help: AppHelp }) {
  return (
    <>
      <p className="text-ink-muted text-[13px]">{help.summary}</p>
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
    </>
  );
}
