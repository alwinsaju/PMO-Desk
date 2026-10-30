/** Turns a failed step's error text (usually the end of a Python traceback) into plain steps a person can follow. Pure. */

export interface Explanation {
  title: string;
  /** What to try, in order. */
  steps: string[];
  /** The last meaningful line of the error, for support. */
  technical: string;
}

interface Rule {
  test: RegExp;
  title: (match: RegExpExecArray) => string;
  steps: (match: RegExpExecArray) => string[];
}

const RULES: Rule[] = [
  {
    test: /PermissionError|being used by another process|Permission denied|sharing violation/i,
    title: () => "A file is open in another program",
    steps: () => [
      "Close any Excel workbook from this task (and the output folder, if it is open in a window).",
      "Press Retry. It carries on from the step that failed; finished steps are not repeated.",
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
      "Copy the details below and send them to whoever supports AI OS.",
    ],
  },
  {
    test: /TimeoutExpired|timed out|Timeout/i,
    title: () => "The step took too long",
    steps: () => [
      "Close other heavy programs (large Excel files, Outlook syncing) and Retry.",
      "If it happens again, copy the details below for support.",
    ],
  },
  {
    test: /UnicodeDecodeError|UnicodeEncodeError/i,
    title: () => "A file has characters the task cannot read",
    steps: () => [
      "Re-save the file from Excel as .xlsx and upload it again.",
      "Retry. If it fails again, copy the details below for support.",
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

export function explainFailure(
  error: string | null | undefined,
  stepName?: string | null,
): Explanation {
  const text = error ?? "";
  for (const rule of RULES) {
    const match = rule.test.exec(text);
    if (match) {
      return {
        title: rule.title(match),
        steps: rule.steps(match),
        technical: lastLine(text),
      };
    }
  }
  return {
    title: stepName ? `Something went wrong in “${stepName}”` : "Something went wrong",
    steps: [
      "Check that the files you uploaded are the right ones and are not open in Excel.",
      "Press Retry. If it fails again, copy the details below for support.",
    ],
    technical: lastLine(text),
  };
}

/** The label for the retry button: it resumes after the last finished step. */
export function retryLabel(stepName: string | null | undefined): string {
  return stepName ? `Retry from “${stepName}”` : "Retry";
}
