// The PMO lead works in India Standard Time; relative dates in messages
// ("by Friday") are resolved against it. IST has no daylight saving.
export const PMO_TIME_ZONE = "Asia/Kolkata";

/** YYYY-MM-DD of an instant, as seen in IST. */
export function istDate(instant: Date | string | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/** "2026-10-22T09:14 IST (Thursday 22 October 2026)" for the model's context. */
export function istStamp(instant: Date | string | number): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return String(instant);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: PMO_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: PMO_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${istDate(date)}T${time} IST (${day})`;
}
