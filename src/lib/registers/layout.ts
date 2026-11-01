// How the PMO Toolkit and a register's form are laid out. Pure; see registerView.test.mjs.
import type { FieldDef, RegisterDef } from "./types.ts";

/** The launcher's groups. Every tool id appears once. */
export const TOOL_GROUPS: readonly { title: string; ids: readonly string[] }[] = [
  { title: "Risks and decisions", ids: ["raid", "decisions", "changes", "lessons"] },
  {
    title: "People and time",
    ids: ["timesheets", "capacity", "stakeholders", "minutes"],
  },
  { title: "Delivery", ids: ["status-report", "governance", "sla", "doclinks"] },
  { title: "Finance and contracts", ids: ["vendors", "invoices"] },
];

/** Tools in the launcher's group order; any tool missing from the groups lands in a last "More" group. */
export function groupTools<T extends { id: string }>(
  tools: readonly T[],
): { title: string; tools: T[] }[] {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const placed = new Set<string>();
  const groups = TOOL_GROUPS.map((group) => ({
    title: group.title,
    tools: group.ids.flatMap((id) => {
      const tool = byId.get(id);
      if (!tool) return [];
      placed.add(id);
      return [tool];
    }),
  }));
  const rest = tools.filter((tool) => !placed.has(tool.id));
  if (rest.length > 0) groups.push({ title: "More", tools: rest });
  return groups.filter((group) => group.tools.length > 0);
}

/** The form's sections: the definition's own groups, else What / Who / When / Details by field type. */
export function formSections(def: RegisterDef): { title: string; fields: FieldDef[] }[] {
  if (def.formGroups) {
    const known = new Set(def.formGroups.flatMap((g) => g.keys));
    const leftover = def.fields.filter((f) => !known.has(f.key));
    return def.formGroups.map((group, index) => ({
      title: group.title,
      fields: [
        ...group.keys.flatMap((key) => def.fields.filter((f) => f.key === key)),
        ...(index === 0 ? leftover : []),
      ],
    }));
  }
  const pick = (test: (f: FieldDef) => boolean) => def.fields.filter(test);
  const sections = [
    {
      title: "What",
      fields: pick((f) => !["person", "date", "longtext"].includes(f.type)),
    },
    { title: "Who", fields: pick((f) => f.type === "person") },
    { title: "When", fields: pick((f) => f.type === "date") },
    { title: "Details", fields: pick((f) => f.type === "longtext") },
  ];
  return sections.filter((section) => section.fields.length > 0);
}
