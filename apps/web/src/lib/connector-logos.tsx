import { LinearLogo } from "@repo/ui/components/logos/linear"
import { cn } from "@repo/ui/lib/utils"
import { Github } from "lucide-react"
import type { ComponentType } from "react"
import type { AvailableCapability } from "@/lib/api-types"

type ConnectorKey = AvailableCapability["connector"]
type ConnectorLogo = ComponentType<{ className?: string }>

// fill-current so brand marks inherit the surrounding text color.
function LinearMark({ className }: { className?: string }) {
  return <LinearLogo variant="logo" className={cn(className, "fill-current")} />
}

// Exhaustive over the connector keys — a new connector without a logo is a
// compile error (no silent fallback).
const CONNECTOR_LOGOS: Record<ConnectorKey, ConnectorLogo> = {
  github: Github,
  linear: LinearMark,
}

export function connectorLogo(key: ConnectorKey): ConnectorLogo {
  return CONNECTOR_LOGOS[key]
}
