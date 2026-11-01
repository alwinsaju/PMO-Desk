// What the first-run wizard says about its progress and the answers so far.
// Pure, so the wording and the summary rows are tested (wizardView.test.mjs).
import { splitList, type FirstRunForm, type FirstRunStepId } from "./firstRun.ts";
import { checkEmail, parseDomainList } from "./listValidation.ts";

export interface WizardProgress {
  label: string;
  /** How much of the bar is filled; the current step counts as reached. */
  percent: number;
}

export function wizardProgress(step: number, total: number): WizardProgress {
  const at = Math.min(Math.max(step, 0), total - 1);
  return {
    label: `Step ${at + 1} of ${total}`,
    percent: Math.round(((at + 1) / total) * 100),
  };
}

/** The label under each dot of the stepper. */
export const STEP_SHORT: Record<FirstRunStepId, string> = {
  who: "You",
  timeZone: "Time zone",
  domains: "Domains",
  inbox: "Inbox",
};

/** One line under the heading; each step has its own. */
export const STEP_INTRO: Record<FirstRunStepId, string> = {
  who: "Your work email brings in your name and photo from Microsoft 365 and puts you on the staff roster. Nothing is read from your mail until you finish this.",
  timeZone: "Due dates and reminders follow this, so “Friday” means your Friday.",
  domains: "Only mail from these domains can become a to-do.",
  inbox:
    "The folder your Outlook flow drops messages into. It is only read, and a new folder is created only when you click the button.",
};

export interface SummaryRow {
  label: string;
  value: string;
  /** The step where this answer is changed. */
  step: FirstRunStepId;
}

const orNotSet = (value: string) => value.trim() || "Not set";

/** The picture on each step's header: a name the wizard maps to an icon. */
export const STEP_ICON: Record<FirstRunStepId, "user" | "clock" | "at" | "folder"> = {
  who: "user",
  timeZone: "clock",
  domains: "at",
  inbox: "folder",
};

export interface NextStep {
  icon: "folder" | "robot" | "review" | "bell";
  title: string;
  text: string;
}

/** The "You're set" screen: what the app does now, in the order it happens. */
export function nextSteps(form: FirstRunForm): NextStep[] {
  const allowed = parseDomainList(form.allowedDomains).valid;
  const folder = form.inboxDir.trim();
  return [
    {
      icon: "folder",
      title: "Mail arrives in your inbox folder",
      text: folder
        ? `Messages your flow saves to ${folder} are picked up automatically.`
        : "Messages your flow saves to the inbox folder are picked up automatically.",
    },
    {
      icon: "robot",
      title: "The local AI drafts a to-do",
      text:
        allowed.length > 0
          ? `Mail from ${allowed.join(", ")} is read on this computer and turned into a draft. Mail from any other domain is filtered out.`
          : "Mail from your allowed domains is read on this computer and turned into a draft.",
    },
    {
      icon: "review",
      title: "You approve it in the Review Queue",
      text: "Nothing becomes a to-do until you approve it. You can edit the draft, or reject it.",
    },
    {
      icon: "bell",
      title: "Reminders keep you on track",
      text: "Due and overdue to-dos remind you on this computer. Change this any time in Settings.",
    },
  ];
}

/** The answers in the order of the steps, shown before Finish. */
export function wizardSummary(form: FirstRunForm): SummaryRow[] {
  const others = splitList(form.otherNames, { commasOnly: true });
  const name = form.fullName.trim();
  const allowed = parseDomainList(form.allowedDomains).valid;
  const blocked = parseDomainList(form.blockedDomains).valid;
  return [
    {
      label: "Name",
      value: name
        ? others.length > 0
          ? `${name} (also ${others.join(", ")})`
          : name
        : checkEmail(form.email).ok
          ? "From your Microsoft 365 profile"
          : "Not set",
      step: "who",
    },
    { label: "Email", value: orNotSet(form.email), step: "who" },
    { label: "Time zone", value: orNotSet(form.timeZone), step: "timeZone" },
    {
      label: "Allowed domains",
      value: allowed.length > 0 ? allowed.join(", ") : "Not set",
      step: "domains",
    },
    {
      label: "Blocked domains",
      value: blocked.length > 0 ? blocked.join(", ") : "None",
      step: "domains",
    },
    { label: "Inbox folder", value: orNotSet(form.inboxDir), step: "inbox" },
  ];
}
