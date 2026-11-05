/** Turns a failed step's error text (usually the end of a Python traceback) into plain steps a person can follow. Pure. */

export interface Explanation {
  title: string;
  /** What to try, in order. */
  steps: string[];
  /** The last meaningful line of the error, for support. May name folders: show it only behind "Show details". */
  technical: string;
  /** What the task said in its own plain words (folders removed), when it stopped with a message rather than a
   *  traceback: "Row 7: the Updated cell is text, not a date." */
  message?: string;
}

interface Rule {
  test: RegExp;
  title: (match: RegExpExecArray) => string;
  steps: (match: RegExpExecArray) => string[];
}

const RULES: Rule[] = [
  {
    test: /The engine restarted while this task was running/i,
    title: () => "The Tasks engine restarted while this task was running",
    steps: () => [
      "Nothing was sent. Press Retry: it carries on after the last step that finished.",
    ],
  },
  {
    test: /PermissionError|being used by another process|Permission denied|sharing violation/i,
    title: () => "A file is open in another program",
    steps: () => [
      "Close any Excel workbook from this task (and the output folder, if it is open in a window).",
      "Press Retry. It carries on from the step that failed; finished steps are not repeated.",
    ],
  },
  {
    // openpyxl reports a missing sheet as KeyError: 'Worksheet <name> does not exist.'
    test: /Worksheet (?:named )?['"]?([^'"\r\n]+?)['"]?(?: does not exist| not found)\.?['"]?/i,
    title: (m) => `The sheet “${m[1].trim()}” was not found`,
    steps: (m) => [
      `Open the file and check that a sheet (tab at the bottom) is named exactly “${m[1].trim()}”.`,
      "Fix the sheet name, or download the export again without renaming sheets, upload it and Retry.",
    ],
  },
  {
    test: /The export has no sheet called ["“]([^"”]+)["”]/i,
    title: (m) => `The sheet “${m[1]}” was not found`,
    steps: (m) => [
      `Open the file and check that a sheet (tab at the bottom) is named exactly “${m[1]}”.`,
      "Download the export again without renaming sheets, upload it and Retry.",
    ],
  },
  {
    test: /The export has no column called/i,
    title: () => "A column the task needs is missing",
    steps: () => [
      "Download the export again from ServiceNow without removing or renaming columns.",
      "Upload it and Retry.",
    ],
  },
  {
    test: /Unexpected column layout/i,
    title: () => "The file's columns are not the ones this task expects",
    steps: () => [
      "Check that you uploaded the right export for this task (each task needs its own export).",
      "Download the export again without renaming or removing columns, upload it and Retry.",
    ],
  },
  {
    test: /No previous monthly workbook/i,
    title: () => "The previous monthly workbook is needed",
    steps: () => [
      "Upload last month's finished workbook in the “previous workbook” slot (the first run needs one).",
      "Press Retry.",
    ],
  },
  {
    test: /AttributeError: 'str' object has no attribute '(?:year|month|day|date|strftime|isoformat)'|time data .* does not match format|Invalid isoformat|cannot convert .* to datetime|cell holds text .*not a date/i,
    title: () => "A date column has text that is not a date",
    steps: () => [
      "In the export, check the date columns (for example Updated and Opened): every cell must be a real date, not typed text or a blank.",
      "Fix those cells (or download the export again), upload it and Retry.",
    ],
  },
  {
    test: /KeyError:\s*['"]([^'"]+)['"]/,
    title: (m) => `A column called “${m[1]}” is missing`,
    steps: (m) => [
      `Open the export and check that a column named exactly “${m[1]}” is on the first sheet.`,
      "Download the export again from ServiceNow (do not rename or remove columns), upload it and Retry.",
    ],
  },
  {
    test: /No raw ServiceNow export found|FileNotFoundError|No such file or directory|cannot find the (file|path)/i,
    title: () => "A file the task needs was not found",
    steps: () => [
      "Open Run and check that every required file shows as uploaded.",
      "Upload the missing file again, then Retry.",
    ],
  },
  {
    test: /BadZipFile|not a zip file|InvalidFileException|openpyxl.*(load|read)|file format and extension don't match/i,
    title: () => "The Excel file could not be read",
    steps: () => [
      "Open the file in Excel and save it as a normal .xlsx workbook (not .xls or .csv).",
      "Upload the saved copy and Retry.",
    ],
  },
  {
    test: /com_error|pywintypes|Cannot create ActiveX|MAPI|Outlook.*(not|unable|failed)|0x800/i,
    title: () => "Outlook was not ready",
    steps: () => [
      "Open Outlook, wait for it to finish loading and make sure you are signed in.",
      "Press Retry. Nothing is sent: it only creates a draft for you to review.",
    ],
  },
  {
    test: /ModuleNotFoundError|ImportError|No module named/i,
    title: () => "A Python component is missing",
    steps: () => [
      "This is a set-up problem, not a problem with your files.",
      "Open “Show details”, copy them and send them to whoever supports PMO Desk.",
    ],
  },
  {
    test: /TimeoutExpired|timed out|Timeout/i,
    title: () => "The step took too long",
    steps: () => [
      "Close other heavy programs (large Excel files, Outlook syncing) and Retry.",
      "If it happens again, open “Show details”, copy them and send them to support.",
    ],
  },
  {
    test: /UnicodeDecodeError|UnicodeEncodeError/i,
    title: () => "A file has characters the task cannot read",
    steps: () => [
      "Re-save the file from Excel as .xlsx and upload it again.",
      "Retry. If it fails again, open “Show details”, copy them and send them to support.",
    ],
  },
];

/** The last non-blank line: where a traceback says what went wrong. */
export function lastLine(error: string | null | undefined): string {
  const lines = (error ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 300);
}

/** Folder names on this computer are not for the headline: "C:\Users\a\input\x.xlsx" becomes "x.xlsx". */
export function hidePaths(text: string): string {
  return text.replace(/[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*/g, "");
}

/** What a task script said in its own plain words (it stopped with a message, not a traceback). */
function scriptMessage(text: string): string | null {
  if (/Traceback|^\s*File "|\b\w*(?:Error|Exception)\b:/m.test(text)) return null;
  const line = hidePaths(lastLine(text)).trim();
  return line.length >= 8 ? line : null;
}

export interface ExplainOptions {
  /** False for a task that takes no uploaded files: the fallback then does not tell people to check uploads. */
  hasUploads?: boolean;
}

export function explainFailure(
  error: string | null | undefined,
  stepName?: string | null,
  options: ExplainOptions = {},
): Explanation {
  const text = error ?? "";
  const message = scriptMessage(text) ?? undefined;
  for (const rule of RULES) {
    const match = rule.test.exec(text);
    if (match) {
      return {
        title: rule.title(match),
        steps: rule.steps(match),
        technical: lastLine(text),
        message,
      };
    }
  }
  return {
    title: stepName ? `Something went wrong in “${stepName}”` : "Something went wrong",
    steps: [
      options.hasUploads === false
        ? "Close any workbook from this task that is open in Excel."
        : "Check that the files you uploaded are the right ones and are not open in Excel.",
      "Press Retry. If it fails again, open “Show details”, copy them and send them to support.",
    ],
    technical: lastLine(text),
    message,
  };
}

/** The label for the retry button: it resumes after the last finished step. */
export function retryLabel(stepName: string | null | undefined): string {
  return stepName ? `Retry from “${stepName}”` : "Retry";
}
