import { Code, Github, type LucideIcon } from "lucide-react"
import type { MerlinCapabilityKey } from "@/lib/api-types"

// Exhaustive over the capability keys — a new capability without an icon is a
// compile error (no silent fallback).
const CAPABILITY_ICONS: Record<MerlinCapabilityKey, LucideIcon> = {
  github: Github,
  code: Code,
}

export function capabilityIcon(key: MerlinCapabilityKey): LucideIcon {
  return CAPABILITY_ICONS[key]
}
