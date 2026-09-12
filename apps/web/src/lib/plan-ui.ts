import {
  Alert01Icon,
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import type { RealtimePlanStatus } from "@repo/realtime-types"

type IconSvgObject = typeof Clock01Icon

export type PlanStatusMeta = {
  label: string
  badgeVariant: "info" | "warning" | "success" | "error" | "secondary"
  icon: IconSvgObject
  spin?: boolean
}

export const PLAN_STATUS_META: Record<RealtimePlanStatus, PlanStatusMeta> = {
  running: {
    label: "Running",
    badgeVariant: "info",
    icon: Loading03Icon,
    spin: true,
  },
  waiting_for_input: {
    label: "Waiting on the team",
    badgeVariant: "warning",
    icon: Clock01Icon,
  },
  waiting_for_approval: {
    label: "Needs approval",
    badgeVariant: "warning",
    icon: Alert01Icon,
  },
  completed: {
    label: "Completed",
    badgeVariant: "success",
    icon: CheckmarkCircle02Icon,
  },
  failed: {
    label: "Failed",
    badgeVariant: "error",
    icon: AlertCircleIcon,
  },
  stopped: {
    label: "Stopped",
    badgeVariant: "secondary",
    icon: Cancel01Icon,
  },
}
