import { env } from "@repo/env/client"

export function getInviteUrl(code: string) {
  const currentOrigin = window.location.origin
  const webOrigin =
    window.location.protocol === "http:" ||
    window.location.protocol === "https:"
      ? currentOrigin
      : env.NEXT_PUBLIC_WEB_URL

  return `${webOrigin}/invite/${code}`
}
