/** Finding a person by name for the profile card, and the contact lines it shows. Pure. */
import type { Employee } from "./types.ts";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The directory person for an id, else the one whose name matches exactly (first last, or last first). null if
 *  none or if two people share the name. */
export function findPerson(
  employees: readonly Employee[],
  name: string,
  employeeId?: string | null,
): Employee | null {
  if (employeeId) {
    const byId = employees.find((e) => e.id === employeeId);
    if (byId) return byId;
  }
  const q = norm(name);
  if (!q) return null;
  const hits = employees.filter((e) => {
    const a = norm(`${e.firstName} ${e.lastName}`);
    const b = norm(`${e.lastName} ${e.firstName}`);
    return a === q || b === q || norm(e.deloitteEmail) === q;
  });
  return hits.length === 1 ? hits[0] : null;
}

export function profileLines(e: Employee): string[] {
  return [
    e.deloitteEmail,
    e.phone,
    [e.homeOffice, e.location].filter(Boolean).join(", "),
    e.clientManager ? `Client manager: ${e.clientManager}` : "",
    e.skills.length ? `Skills: ${e.skills.slice(0, 5).join(", ")}` : "",
  ].filter(Boolean);
}
