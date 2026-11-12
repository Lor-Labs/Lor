import { auth } from "@repo/auth"
import { openBrowserView } from "@repo/lor/dev-env/browser"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import {
  browserSeenRecently,
  findPreviewLink,
  markBrowserSeen,
  previewAccess,
  storedAnnotations,
  syncAnnotationsSoon,
} from "@/lib/session-previews"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetPreviewRoute,
  MarkPreviewSeenRoute,
  OpenPreviewViewRoute,
} from "@/routes/v1/previews/routes"

// Preview links (reference/planned/sandbox-browser-runbook.md §8). A link
// that is off, expired or unknown reads as not found, like one that never
// existed.

const NOT_FOUND = {
  success: false as const,
  message: "This preview link is off or has expired",
}

async function resolve(token: string, headers: Headers) {
  const [preview, session] = await Promise.all([
    findPreviewLink(token),
    auth.api.getSession({ headers }),
  ])
  if (!preview) return null
  const user = session?.user ?? null
  return {
    preview,
    user,
    access: await previewAccess(preview, user?.id ?? null),
  }
}

export const getPreview: AppRouteHandler<GetPreviewRoute> = async (c) => {
  const { token } = c.req.valid("param")
  const found = await resolve(token, c.req.raw.headers)
  if (!found) return c.json(NOT_FOUND, HttpStatusCodes.NOT_FOUND)
  const { preview, user, access } = found
  if (access.status !== "ready") {
    return c.json({ status: access.status }, HttpStatusCodes.OK)
  }
  return c.json(
    {
      status: "ready" as const,
      access: preview.link.access,
      title: preview.session.title,
      workspaceName: preview.workspaceName,
      sessionId: access.member ? preview.session.id : null,
      workspaceSlug: access.member ? preview.workspaceSlug : null,
      viewer: {
        signedIn: user !== null,
        annotate: access.annotate,
        control: access.control,
      },
    },
    HttpStatusCodes.OK
  )
}

export const openPreviewView: AppRouteHandler<OpenPreviewViewRoute> = async (
  c
) => {
  const { token } = c.req.valid("param")
  const found = await resolve(token, c.req.raw.headers)
  if (!found) return c.json(NOT_FOUND, HttpStatusCodes.NOT_FOUND)
  const { preview, user, access } = found
  if (access.status === "sign_in_required") {
    return c.json(
      { success: false as const, message: "Sign in to see this preview" },
      HttpStatusCodes.UNAUTHORIZED
    )
  }
  if (access.status === "no_access") {
    return c.json(
      { success: false as const, message: "This preview is private" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const sessionId = preview.session.id
  // Checked before anything touches the sandbox, which would wake it.
  if (!user && !(await browserSeenRecently(sessionId))) {
    return c.json({ status: "asleep" as const }, HttpStatusCodes.OK)
  }
  const result = await openBrowserView(
    sessionId,
    user
      ? {
          userId: user.id,
          name: user.name,
          annotate: access.annotate,
          // Send to Lor happens in the app.
          send: false,
        }
      : { anonymous: true },
    {
      preview: true,
      ...(user ? { stored: () => storedAnnotations(sessionId) } : {}),
    }
  )
  if (result.status !== "ready") {
    return c.json({ status: "unavailable" as const }, HttpStatusCodes.OK)
  }
  if (user) await markBrowserSeen(sessionId)
  return c.json(
    {
      status: "ready" as const,
      url: result.url,
      role: result.role,
      controller: result.controller,
    },
    HttpStatusCodes.OK
  )
}

export const markPreviewSeen: AppRouteHandler<MarkPreviewSeenRoute> = async (
  c
) => {
  const { token } = c.req.valid("param")
  const body = c.req.valid("json")
  const found = await resolve(token, c.req.raw.headers)
  if (!found) return c.json(NOT_FOUND, HttpStatusCodes.NOT_FOUND)
  const { preview, user, access } = found
  if (!user || access.status === "sign_in_required") {
    return c.json(
      { success: false as const, message: "Sign in to see this preview" },
      HttpStatusCodes.UNAUTHORIZED
    )
  }
  if (access.status === "no_access") {
    return c.json(
      { success: false as const, message: "This preview is private" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  await markBrowserSeen(preview.session.id)
  if (body.annotations) syncAnnotationsSoon(preview.session.id)
  return c.json({ ok: true as const }, HttpStatusCodes.OK)
}
