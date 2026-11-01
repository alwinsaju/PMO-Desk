// "Updated 3 min ago" next to the Dashboard's Refresh button. Pure.

const MINUTE_MS = 60_000;

export function updatedLabel(updatedAt: Date, now: Date): string {
  const minutes = Math.floor(
    Math.max(0, now.getTime() - updatedAt.getTime()) / MINUTE_MS,
  );
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return "Updated over a day ago";
}
