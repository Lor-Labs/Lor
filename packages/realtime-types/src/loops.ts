// Human-readable cron schedule descriptions, shared by the server (cards,
// channel notes, run prompts) and clients (loop card). Lives here rather than
// @repo/merlin because it's pure string parsing (no croner) and web imports
// this package but not the server-side merlin package.

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

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
    return list.map((d) => DAY_NAMES[Number(d)]).join(", ")
  }
  return null
}

// Covers the common shapes Merlin proposes, falls back to a labeled cron for
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
      // Comma lists ("Monday, Friday") don't pluralize cleanly — fall through.
      if (days !== null && !days.includes(",")) {
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
// cron day field ("1", "1-5", "0,6") so presets like weekdays survive.
export type LoopScheduleShape =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; dow: string; hour: number; minute: number }
  | { kind: "monthly"; dom: number; hour: number; minute: number }
  | { kind: "custom"; schedule: string }

const EDITABLE_DOW = /^([0-6]|1-5|0,6|6,0)$/

export function parseLoopSchedule(schedule: string): LoopScheduleShape {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length === 5) {
    const [min = "", hour = "", dom = "", month = "", dow = ""] = fields
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
    case "custom":
      return shape.schedule
  }
}
