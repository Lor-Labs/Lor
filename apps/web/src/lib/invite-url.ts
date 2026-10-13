import { webOrigin } from "@/lib/web-origin"

export function getInviteUrl(code: string) {
  return `${webOrigin()}/invite/${code}`
}
