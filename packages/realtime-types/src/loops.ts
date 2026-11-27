// Human-readable cron schedule descriptions, shared by the server (cards,
// channel notes, run prompts) and clients (loop card). Lives here rather than
// @repo/lor because it's pure string parsing (no croner) and web imports
// this package but not the server-side lor package.

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour < 12 ? "AM" : "PM"
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`
}

// 12-hour label for schedule time pickers ("9:00 AM") — same formatting the
// describer uses, so pickers and summaries always agree.
export function formatScheduleTime(hour: number, minute: number): string {
  return formatTime(hour, minute)
}

function describeDayField(dow: string): string | null {
  if (dow === "1-5") return "weekday"
  if (dow === "0,6" || dow === "6,0") return "weekend day"
  const single = /^[0-6]$/.test(dow) ? DAY_NAMES[Number(dow)] : null
  if (single) return single
  const list = dow.split(",")
  if (list.every((d) => /^[0-6]$/.test(d))) {
    // Multi-day lists use short names — full names eat the whole chip when
    // 4-5 days are selected.
    const names = [...new Set(list.map(Number))]
      .sort((a, b) => a - b)
      .map((d) => DAY_ABBREV[d])
    if (names.length === 1) return DAY_NAMES[Number(list[0])] ?? null
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`
  }
  return null
}

// Covers the common shapes Lor proposes, falls back to a labeled cron for
// everything else. Null timezone (unpinned draft) omits the suffix — clients
// render those in the viewer's device timezone.
export function describeLoopSchedule(
  schedule: string,
  timezone: string | null
): string {
  const suffix = timezone ? ` (${timezone})` : ""
  const fields = schedule.trim().split(/\s+/)
  if (fields.length === 5) {
    const [min = "", hour = "", dom = "", month = "", dow = ""] = fields

    const shape = parseLoopSchedule(schedule)
    if (shape.kind === "interval") {
      const days = shape.dow === "*" ? "every day" : describeDayField(shape.dow)
      if (days) {
        const every =
          shape.every === 60 ? "Every hour" : `Every ${shape.every} minutes`
        if (shape.fromHour === 0 && shape.toHour === 24) {
          const on =
            days === "every day"
              ? ""
              : days.includes("&") || days.includes(",")
                ? ` on ${days}`
                : ` on ${days}s`
          return `${every}${on}${suffix}`
        }
        const on =
          days === "every day"
            ? days
            : days.includes("&") || days.includes(",")
              ? `on ${days}`
              : `on ${days}s`
        return `${every} from ${formatTime(shape.fromHour, 0)} to ${formatTime(shape.toHour % 24, 0)} ${on}${suffix}`
      }
    }

    const everyN = /^\*\/(\d+)$/.exec(min)
    if (everyN && hour === "*" && dom === "*" && month === "*" && dow === "*") {
      const n = Number(everyN[1])
      return n === 1 ? `Every minute${suffix}` : `Every ${n} minutes${suffix}`
    }

    // Hourly shapes: "0 * * * *", "30 */2 * * *", "0 * * * 1-5", …
    if (
      /^\d+$/.test(min) &&
      (hour === "*" || /^\*\/\d+$/.test(hour)) &&
      dom === "*" &&
      month === "*"
    ) {
      const n = hour === "*" ? 1 : Number(hour.slice(2))
      const days = dow === "*" ? "" : describeDayField(dow)
      // Day lists ("Mon & Fri") don't pluralize cleanly — fall through.
      if (days !== null && !days.includes(",") && !days.includes("&")) {
        const base = n === 1 ? "Every hour" : `Every ${n} hours`
        const at = Number(min) === 0 ? "" : ` at :${min.padStart(2, "0")}`
        const on = days ? ` on ${days}s` : ""
        return `${base}${at}${on}${suffix}`
      }
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && month === "*") {
      const time = formatTime(Number(hour), Number(min))
      if (dom === "*" && dow === "*") return `Every day at ${time}${suffix}`
      if (dom === "*") {
        const days = describeDayField(dow)
        if (days) return `Every ${days} at ${time}${suffix}`
      }
      if (dow === "*" && /^\d+$/.test(dom)) {
        return `Monthly on day ${Number(dom)} at ${time}${suffix}`
      }
    }
  }
  return `Custom schedule "${schedule}"${suffix}`
}

// Structured view of the cron shapes the schedule editor can round-trip:
// everything else is "custom" and renders read-only. `dow` keeps the raw
// cron day field ("1", "1-5", "0,6", "1,4,6") so presets and multi-day
// selections survive.
export type LoopScheduleShape =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; dow: string; hour: number; minute: number }
  | { kind: "monthly"; dom: number; hour: number; minute: number }
  // Through the day: every 15, 30 or 60 minutes from `fromHour` until
  // `toHour` (exclusive) on `dow` ("*" for every day). The channel agent's
  // check-in Loop is one (reference/always-on-agents.md, decision 7).
  | {
      kind: "interval"
      every: number
      fromHour: number
      toHour: number
      dow: string
    }
  | { kind: "custom"; schedule: string }

// Weekday range preset, or any comma list of days (single day included) —
// the editor's multi-day picker emits sorted lists like "1,4,6".
const EDITABLE_DOW = /^(1-5|[0-6](,[0-6])*)$/

export const INTERVAL_EVERY_OPTIONS = [15, 30, 60] as const

export function parseLoopSchedule(schedule: string): LoopScheduleShape {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length === 5) {
    const [min = "", hour = "", dom = "", month = "", dow = ""] = fields
    // "*" is all day, from midnight to midnight.
    const hours = hour === "*" ? ["*", "0", "23"] : /^(\d+)-(\d+)$/.exec(hour)
    const every =
      min === "0" ? 60 : Number(/^\*\/(\d+)$/.exec(min)?.[1] ?? Number.NaN)
    // "0 * * * *" stays the hourly shape; on weekdays it is an interval.
    if (
      hours &&
      !(hour === "*" && every === 60 && dow === "*") &&
      dom === "*" &&
      month === "*" &&
      (dow === "*" || EDITABLE_DOW.test(dow)) &&
      (INTERVAL_EVERY_OPTIONS as readonly number[]).includes(every)
    ) {
      const fromHour = Number(hours[1])
      const lastHour = Number(hours[2])
      if (fromHour <= lastHour && lastHour <= 23) {
        return { kind: "interval", every, fromHour, toHour: lastHour + 1, dow }
      }
    }
    if (/^\d+$/.test(min) && month === "*") {
      const minute = Number(min)
      if (hour === "*" && dom === "*" && dow === "*") {
        return { kind: "hourly", minute }
      }
      if (/^\d+$/.test(hour)) {
        const h = Number(hour)
        if (dom === "*" && dow === "*") {
          return { kind: "daily", hour: h, minute }
        }
        if (dom === "*" && EDITABLE_DOW.test(dow)) {
          return { kind: "weekly", dow, hour: h, minute }
        }
        if (dow === "*" && /^\d+$/.test(dom)) {
          return { kind: "monthly", dom: Number(dom), hour: h, minute }
        }
      }
    }
  }
  return { kind: "custom", schedule }
}

export function formatLoopSchedule(shape: LoopScheduleShape): string {
  switch (shape.kind) {
    case "hourly":
      return `${shape.minute} * * * *`
    case "daily":
      return `${shape.minute} ${shape.hour} * * *`
    case "weekly":
      return `${shape.minute} ${shape.hour} * * ${shape.dow}`
    case "monthly":
      return `${shape.minute} ${shape.hour} ${shape.dom} * *`
    case "interval":
      return `${shape.every === 60 ? "0" : `*/${shape.every}`} ${shape.fromHour === 0 && shape.toHour === 24 ? "*" : `${shape.fromHour}-${shape.toHour - 1}`} * * ${shape.dow}`
    case "custom":
      return shape.schedule
  }
}

// Editable dow field ↔ sorted day numbers, for the multi-day picker.
export function dowToDays(dow: string): number[] {
  if (dow === "1-5") return [1, 2, 3, 4, 5]
  const days = dow
    .split(",")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return [...new Set(days)].sort((a, b) => a - b)
}

// Collapses back to the presets so "Mon–Fri checked" round-trips as "1-5".
export function daysToDow(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.join(",") === "1,2,3,4,5") return "1-5"
  return sorted.join(",")
}

// What an agent changed on one of its own Loops: the "loop_updated" line in
// the Loop's chat names these (reference/agents-and-chats.md §9).
export type LoopChange =
  | "name"
  | "instructions"
  | "schedule"
  | "end"
  | "chat"
  | "paused"
  | "resumed"

const LOOP_CHANGE_WORDS: Record<LoopChange, string> = {
  name: "name",
  instructions: "instructions",
  schedule: "schedule",
  end: "when it ends",
  chat: "where it reports",
  paused: "paused",
  resumed: "resumed",
}

// How that line reads: "{agent} paused the loop X", "resumed", or "changed"
// with what changed after it.
export function describeLoopChanges(changes: readonly LoopChange[] = []): {
  verb: "paused" | "resumed" | "changed"
  detail: string | null
} {
  const only = changes.length === 1 ? changes[0] : null
  if (only === "paused" || only === "resumed") {
    return { verb: only, detail: null }
  }
  return {
    verb: "changed",
    detail:
      changes.map((change) => LOOP_CHANGE_WORDS[change]).join(", ") || null,
  }
}
