import type { PermissionRequest } from "@repo/auth/permissions"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import {
  assertWorkspaceAuthority,
  type PermissionForStatement,
  type StatementKey,
} from "@/lib/permissions"
import type { AppBindings } from "@/lib/types/app-types"

/**
 * Route-level permission gate. Must run after workspaceAuthMiddleware, which
 * resolves c.var.authority (including custom-role grants).
 *
 * @example
 * middleware: [
 *   workspaceAuthMiddleware,
 *   requireWorkspacePermission("webhook", ["manage"]),
 * ] as const
 */
export function requireWorkspacePermission<
  TResource extends StatementKey,
  const TActions extends readonly PermissionForStatement<TResource>[],
>(resource: TResource, actions: TActions) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const authority = c.var.authority
    if (!authority) {
      throw new HTTPException(HttpStatusCodes.INTERNAL_SERVER_ERROR, {
        message:
          "requireWorkspacePermission must run after workspaceAuthMiddleware",
      })
    }

    assertWorkspaceAuthority(authority, {
      [resource]: actions,
    } as PermissionRequest)

    await next()
  })
}
