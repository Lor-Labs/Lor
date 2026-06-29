import { Code, Github, type LucideIcon, Plug } from "lucide-react"

// Icon for a Merlin capability key. Falls back to a generic plug for
// capabilities added before they get a dedicated icon.
export function capabilityIcon(key: string): LucideIcon {
  switch (key) {
    case "github":
      return Github
    case "code":
      return Code
    default:
      return Plug
  }
}
