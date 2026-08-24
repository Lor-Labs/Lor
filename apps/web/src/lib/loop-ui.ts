import {
  CheckmarkCircle02Icon,
  PauseIcon,
  PencilEdit01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons"
import type { RealtimeLoopStatus } from "@repo/realtime-types"

type IconSvgObject = typeof RepeatIcon

export type LoopStatusMeta = {
  label: string
  badgeVariant: "info" | "warning" | "success" | "error" | "secondary"
  icon: IconSvgObject
}

export const LOOP_STATUS_META: Record<RealtimeLoopStatus, LoopStatusMeta> = {
  draft: {
    label: "Draft",
    badgeVariant: "secondary",
    icon: PencilEdit01Icon,
  },
  active: {
    label: "Active",
    badgeVariant: "info",
    icon: RepeatIcon,
  },
  paused: {
    label: "Paused",
    badgeVariant: "warning",
    icon: PauseIcon,
  },
  completed: {
    label: "Completed",
    badgeVariant: "success",
    icon: CheckmarkCircle02Icon,
  },
}

export const LOOP_PAUSED_REASON_LABEL: Record<string, string> = {
  manual: "Paused by the team",
  failures: "Paused after repeated failures",
  out_of_credits: "Paused - workspace out of credits",
}
