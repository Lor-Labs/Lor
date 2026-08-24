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

// Covers the common shapes Merlin proposes, falls back to the raw cron for
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
  return `Cron "${schedule}"${suffix}`
}
