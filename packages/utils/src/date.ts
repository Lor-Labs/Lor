import { DateTime } from "luxon"

function toDateTime(date: Date | string) {
  const dt =
    typeof date === "string"
      ? DateTime.fromISO(date)
      : DateTime.fromJSDate(date)

  if (!dt.isValid) {
    const originalInput = typeof date === "string" ? date : date.toString()
    throw new Error(`Invalid date input: ${originalInput}`)
  }

  return dt
}

/**
 * Returns a relative time string (e.g. "2 hours ago", "just now").
 * Anything within the last minute collapses to "just now" — Luxon's
 * raw `toRelative()` would say "12 seconds ago" which reads awkwardly.
 */
export function timeAgo(date: Date | string): string {
  const dt = toDateTime(date)
  const diffSec = Math.abs(dt.diffNow("seconds").seconds)
  if (diffSec < 60) return "just now"
  return dt.toRelative() ?? formatDate(date)
}

/**
 * Formats a date as "Jan 1, 2024".
 */
export function formatDate(date: Date | string): string {
  const dt = toDateTime(date)
  return dt.toLocaleString(DateTime.DATE_MED)
}

/**
 * Formats a date as "Jan 1, 2024, 3:45 PM".
 */
export function formatDateTime(date: Date | string): string {
  const dt = toDateTime(date)
  return dt.toLocaleString(DateTime.DATETIME_MED)
}

/**
 * Formats a time as "3:45 PM".
 */
export function formatTime(date: Date | string): string {
  const dt = toDateTime(date)
  return dt.toLocaleString(DateTime.TIME_SIMPLE)
}

/**
 * Returns absolute difference between two timestamps in minutes.
 */
export function differenceInMinutes(
  date1: Date | string,
  date2: Date | string
): number {
  const dt1 = toDateTime(date1)
  const dt2 = toDateTime(date2)

  return Math.abs(dt1.diff(dt2, "minutes").minutes)
}

/**
 * Check if two dates are on the same local day.
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const dt1 = toDateTime(date1).toLocal()
  const dt2 = toDateTime(date2).toLocal()

  return dt1.hasSame(dt2, "day")
}

/**
 * Formats a date label for message list dividers.
 * Returns values like "Today", "Yesterday", or "Monday, December 20, 2024".
 */
export function formatDateDivider(date: Date | string): string {
  const dt = toDateTime(date).toLocal()
  const now = DateTime.now().toLocal()

  if (dt.hasSame(now, "day")) return "Today"
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return "Yesterday"

  return dt.toFormat("cccc, LLLL d, yyyy")
}

/**
 * Groups timestamps by day label ("Today", "Yesterday", "Jan 1, 2024").
 */
export function getDayLabel(date: Date | string): string {
  const dt = toDateTime(date).toLocal()
  const now = DateTime.now().toLocal()

  if (dt.hasSame(now, "day")) return "Today"
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return "Yesterday"
  return formatDate(date)
}

// A call's length: "Under a minute", "12 min", "1 hr 5 min".
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes)
  if (rounded < 1) return "Under a minute"
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`
}

// A moment into a call: "12:40", or "1:04:05" past an hour.
export function formatCallOffset(ms: number): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`
}
