// Built from this app's own better-auth copy: ac/roles exported by
// @repo/auth/permissions come from a different pnpm peer-variant of better-auth
// and are not type-compatible with this app's organizationClient.
import {
  workspaceGrants,
  workspaceStatements,
} from "@repo/auth/workspace-statements"
import { createAccessControl } from "better-auth/plugins/access"
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access"

export const ac = createAccessControl({
  ...defaultStatements,
  ...workspaceStatements,
})

export const owner = ac.newRole({
  ...workspaceGrants,
  ...ownerAc.statements,
})

export const admin = ac.newRole({
  ...workspaceGrants,
  ...adminAc.statements,
})

export const member = ac.newRole({
  ...memberAc.statements,
})
