import {
  CircleDot,
  Code,
  Github,
  type LucideIcon,
  SquarePen,
} from "lucide-react"
import type { MerlinCapabilityKey } from "@/lib/api-types"

// Exhaustive over the capability keys — a new capability without an icon is a
// compile error (no silent fallback).
const CAPABILITY_ICONS: Record<MerlinCapabilityKey, LucideIcon> = {
  github: Github,
  code: Code,
  linear: CircleDot,
  linear_write: SquarePen,
}

export function capabilityIcon(key: MerlinCapabilityKey): LucideIcon {
  return CAPABILITY_ICONS[key]
}
