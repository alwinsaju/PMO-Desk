// Ctrl+K results shown as groups with headers (Apps, People, To-dos, ...), and the
// "Recent" group that leads when the box is empty. Pure: the panel only draws these.
import { searchItems, type SearchItem, type SearchKind } from "./searchIndex.ts";

export type SectionId = "recent" | SearchKind;

export interface SearchSection {
  id: SectionId;
  label: string;
  items: SearchItem[];
}

/** The order of the groups on screen, and their headers. */
export const SECTION_ORDER: readonly { id: SearchKind; label: string }[] = [
  { id: "app", label: "Apps" },
  { id: "person", label: "People" },
  { id: "todo", label: "To-dos" },
  { id: "template", label: "Templates" },
  { id: "record", label: "Records" },
  { id: "note", label: "Notes" },
  { id: "timeoff", label: "Time off" },
];

export const RECENT_LABEL = "Recent";
/** Matches shown for a typed query, across all groups. */
export const GROUPED_LIMIT = 24;

function groupByKind(items: readonly SearchItem[]): SearchSection[] {
  return SECTION_ORDER.flatMap(({ id, label }) => {
    const inGroup = items.filter((item) => item.kind === id);
    return inGroup.length > 0 ? [{ id, label, items: inGroup }] : [];
  });
}

/**
 * What the panel lists. A typed query gives the ranked matches grouped by kind (the
 * best match of a group stays first). An empty query gives "Recent" (still existing
 * items win over the saved snapshot, see `resolveRecents`) followed by the apps that
 * are not already in it.
 */
export function buildSections(
  items: readonly SearchItem[],
  query: string,
  recents: readonly SearchItem[],
): SearchSection[] {
  if (query.trim() !== "") {
    return groupByKind(searchItems(items, query, GROUPED_LIMIT));
  }
  const recentIds = new Set(recents.map((item) => item.id));
  const apps = searchItems(items, "").filter((item) => !recentIds.has(item.id));
  const sections: SearchSection[] = [];
  if (recents.length > 0) {
    sections.push({ id: "recent", label: RECENT_LABEL, items: [...recents] });
  }
  if (apps.length > 0) sections.push({ id: "app", label: "Apps", items: apps });
  return sections;
}

/** The items in on-screen order, which is the order Up/Down walks them. */
export const flattenSections = (sections: readonly SearchSection[]): SearchItem[] =>
  sections.flatMap((section) => section.items);
