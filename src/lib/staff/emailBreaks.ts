/** An email split after each "@" and "."; a narrow column may wrap between the parts,
 *  never in the middle of one ("aarav.sharma@deloitte.c" / "om"). */
export function emailBreakParts(email: string): string[] {
  return email.split(/(?<=[@.])/).filter(Boolean);
}
