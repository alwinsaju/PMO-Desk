// "What's new": release notes shown once after an update and under Settings > About. Pure.
import { compareVersions } from "./version.ts";

export interface ReleaseGroup {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  title: string;
  groups: ReleaseGroup[];
}

/** Newest first. Add a release here when the version in package.json goes up. */
export const RELEASES: readonly Release[] = [
  {
    version: "6.0.1",
    title: "PMO Desk 6.0.1",
    groups: [
      {
        title: "Staff",
        items: [
          "Every Excel import now has Download a blank template: the directory, the shift roster and the Tasks review. Leave any cell empty; only the email is needed for the directory.",
          "People added by hand or imported from Excel are looked up in Microsoft 365, and a person added earlier can be looked up with Get M365 profile.",
          "Deleting someone from Offboarded removes everything kept about them: picture, roster entry and shifts, hand-over files and checklists.",
          "Adding more than ten people at once no longer creates a checklist for each.",
        ],
      },
    ],
  },
  {
    version: "6.0.0",
    title: "PMO Desk 6.0",
    groups: [
      {
        title: "Command bar and search",
        items: [
          "Chase, snooze, complete and create to-dos by typing; ask about a person's shift or a task run.",
          "Ctrl+K searches to-dos, people, templates and runs. Ctrl+, opens Settings.",
          "Risky commands show a confirmation card first, and every command is kept in the history.",
        ],
      },
      {
        title: "PMO To-Do",
        items: [
          "Board and Calendar views, saved filters, tags, bulk actions and repeating to-dos.",
          "Blocked-by links, escalation notes, hand-over to a teammate and a weekly planning pass.",
          "Add to-dos from pasted meeting notes.",
        ],
      },
      {
        title: "Tasks and reports",
        items: [
          "History, Schedule and a send-later queue; a preview and an input check before each run.",
          "Recipients are checked before you confirm a send, and failures are explained in plain words.",
        ],
      },
      {
        title: "Staff and roster",
        items: [
          "Capacity and cover rules, leave approvals with a templated reply, balances and swaps.",
          "On-call rotation, holidays by rule, birthdays, skills, org chart and checklists.",
        ],
      },
      {
        title: "Dashboard and Templates",
        items: [
          "Customisable Dashboard with a Today list, workload, aging, sign-off and health cards.",
          "A dock badge, a daily briefing and PNG or PDF export.",
          "Templates gain conditions, snippets, tags, other wordings, version history and packs.",
        ],
      },
      {
        title: "PMO Toolkit",
        items: [
          "Fourteen small PMO tools in one place: RAID log, meeting minutes, timesheet chaser, decision log, SLA watcher, change requests, governance calendar, stakeholder register, vendor and contract tracker, capacity planner, invoice readiness, status report builder, lessons learned and a document link library.",
          "Each tells you what is late or due soon, shows it on the Dashboard and the dock, and can turn an item into a to-do.",
        ],
      },
      {
        title: "Platform",
        items: [
          "Back up and restore the whole data folder, export your data and view the activity log.",
          "Profile modes, per-app help, a guided tour and sample data to try things out.",
          "A diagnostics bundle for support with secrets removed, and an optional update check (off by default).",
          "Task packs: add a task from a checksummed pack, or build a mailer with a wizard.",
        ],
      },
    ],
  },
];

/** Releases newer than `lastSeen` and not newer than `current`, newest first.
 *  A first run (nothing seen) gets only the latest one. */
export function releasesToShow(lastSeen: string, current: string): Release[] {
  const upTo = RELEASES.filter((r) => compareVersions(r.version, current) <= 0);
  if (!lastSeen) return upTo.slice(0, 1);
  return upTo.filter((r) => compareVersions(r.version, lastSeen) === 1);
}

export const latestRelease = (): Release => RELEASES[0]!;
