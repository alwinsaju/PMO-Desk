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
    version: "6.0.3",
    title: "PMO Desk 6.0.3",
    groups: [
      {
        title: "Your data",
        items: [
          'Notes no longer lose text silently: a note save the computer refuses now says "Not saved" instead of "Saved", your copy is kept and retried, and notes up to 16 MB can be saved. Notes show their real last-edited time, and Undo works after the toolbar buttons.',
          "Restoring a backup checks every file name first and puts your current data back if anything goes wrong part-way.",
          "A Toolkit record that cannot be read is listed with the reason and kept, instead of being hidden and deleted on the next save.",
          "Very long notes no longer make PMO Desk take minutes to close.",
        ],
      },
      {
        title: "PMO To-Do and the AI",
        items: [
          'Due dates the AI reads from an email ("by Friday", "by yesterday") are checked against the calendar, and a deadline that has already passed stays as the due date so the to-do shows as overdue.',
          "A very long email is read from both ends, and the card says when only part was read.",
          "Drafts no longer name you as owner of a message that is not a task, or invent an attachment. You can change the inbox folder in PMO settings.",
          "The To-Do list draws only what is on screen and refreshes far more cheaply, so a few hundred to-dos stay quick.",
        ],
      },
      {
        title: "Staff",
        items: [
          'Time off for several dates at once ("5-7 Nov, 12 Nov") now saves.',
          "Adding people tells you which email is wrong instead of failing the whole batch; removing a thousand people takes a second; the directory and the roster grid are faster and the roster grid works with the arrow keys.",
          "Overlapping time off is refused with a clear message, Birthday is part of the CSV, and checks run on imports before anything is saved.",
        ],
      },
      {
        title: "PMO Toolkit",
        items: [
          "Long lists stay quick. Over-long entries are refused with a character count instead of being cut. Making to-dos from minutes or a meeting cannot create duplicates.",
          "Past missing timesheet weeks now count as late, SLA and invoice checks agree with the tiles, and a record changed elsewhere is not overwritten without a warning.",
          "CSV exports from every tool are safe to open in Excel.",
        ],
      },
      {
        title: "Tasks and other apps",
        items: [
          "Failures are explained in plain words, with file paths behind Show details. A wrong file is caught before Start. A rejected or reset run is recorded in History and is not counted as a failure.",
          "A mailer pack must have a review step, and the engine can be told not to touch Outlook or Excel (AI_OS_TASKS_OFFICE=off) for testing.",
          "Templates can be restored from a damaged library, the Dashboard shows the true count of what needs you, the Browser works on networks that inspect HTTPS, and the Dashboard PDF fits one page.",
        ],
      },
    ],
  },
  {
    version: "6.0.2",
    title: "PMO Desk 6.0.2",
    groups: [
      {
        title: "Shell",
        items: [
          "The lock screen shows your Microsoft 365 full name and photo, and setup adds you as the first person in Staff.",
          "The quick settings menu stays inside the screen and scrolls when the screen is short.",
          "A window snapped onto the spot it already occupied now settles there instead of staying where the pointer let go.",
          "Toasts fade out, and a directory row flashes when its Microsoft 365 profile arrives.",
        ],
      },
      {
        title: "Tasks",
        items: [
          "Faster incident review, with local-AI Subcategory2 suggestions.",
          "An idle workflow's step timeline starts again from all pending instead of replaying the last run.",
          "The Tasks engine starts even when another Python 3.13 is installed on the computer.",
        ],
      },
    ],
  },
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
