// Reads the weekly report's Markdown (headings, bullets, paragraphs: the dialect
// report.ts writes, and what a person may edit it into) as blocks for a rendered
// preview card. No HTML is produced; the UI draws the blocks as plain text.
import { markdownToPlainText } from "./report.ts";

export interface PreviewStat {
  label: string;
  value: string;
}

export interface PreviewSection {
  heading: string;
  /** The "(3)" at the end of a heading, when it is a plain number. */
  count: number | null;
  bullets: string[];
  /** Text lines under the heading that are not bullets. */
  notes: string[];
  /** A section whose bullets are all "Label: value" (the Summary) reads as stat tiles. */
  stats: PreviewStat[] | null;
}

export interface ReportPreview {
  title: string;
  /** Lines between the title and the first section ("Period: ...", "Status as of ..."). */
  intro: string[];
  sections: PreviewSection[];
}

const inline = (text: string): string => markdownToPlainText(text).trim();

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const COUNT = /^(.*?)\s*\((\d+)\)$/;

function statOf(bullet: string): PreviewStat | null {
  const at = bullet.indexOf(": ");
  if (at <= 0) return null;
  return { label: bullet.slice(0, at), value: bullet.slice(at + 2) };
}

export function parseReportPreview(markdown: string): ReportPreview {
  const preview: ReportPreview = { title: "", intro: [], sections: [] };
  let section: PreviewSection | null = null;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const text = inline(heading[2]);
      if (heading[1].length === 1 && preview.title === "" && section === null) {
        preview.title = text;
        continue;
      }
      const counted = COUNT.exec(text);
      section = {
        heading: counted ? counted[1] : text,
        count: counted ? Number(counted[2]) : null,
        bullets: [],
        notes: [],
        stats: null,
      };
      preview.sections.push(section);
      continue;
    }
    const bullet = BULLET.exec(line);
    const text = inline(bullet ? bullet[1] : line);
    if (text === "") continue;
    if (!section) preview.intro.push(text);
    else if (bullet) section.bullets.push(text);
    else section.notes.push(text);
  }
  for (const found of preview.sections) {
    const stats = found.bullets.map(statOf);
    if (
      stats.length > 0 &&
      stats.every((stat) => stat !== null) &&
      found.notes.length === 0
    )
      found.stats = stats as PreviewStat[];
  }
  return preview;
}

/** Nothing to draw: the text has no title, section or line. */
export const isEmptyPreview = (preview: ReportPreview): boolean =>
  preview.title === "" && preview.intro.length === 0 && preview.sections.length === 0;
