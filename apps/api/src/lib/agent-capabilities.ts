import { ALL_MERLIN_CAPABILITIES, type MerlinCapability } from "@repo/db/schema"

type IntegrationProvider = "github"

// Single source of truth for what each Merlin capability is and which connectors
// must be active to grant it. Drives the "available capabilities" the profile
// editor offers — a workspace can't grant `github` without GitHub connected.
export const CAPABILITY_CATALOG: Record<
  MerlinCapability,
  { label: string; description: string; requires: IntegrationProvider[] }
> = {
  github: {
    label: "GitHub",
    description: "Search and read pull requests & issues",
    requires: ["github"],
  },
  code: {
    label: "Code investigation",
    description:
      "Explore the connected codebase in a ephemeral sandbox environment",
    requires: ["github"],
  },
}

export type CapabilityDescriptor = {
  key: MerlinCapability
  label: string
  description: string
}

// Capabilities a workspace can actually grant given its active connections.
export function availableCapabilities(
  connectedProviders: Set<string>
): CapabilityDescriptor[] {
  return ALL_MERLIN_CAPABILITIES.filter((key) =>
    CAPABILITY_CATALOG[key].requires.every((p) => connectedProviders.has(p))
  ).map((key) => ({
    key,
    label: CAPABILITY_CATALOG[key].label,
    description: CAPABILITY_CATALOG[key].description,
  }))
}
