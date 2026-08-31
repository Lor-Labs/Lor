import { describe, expect, it } from "vitest"
import {
  canManageWorkspaceAuthority,
  formatWorkspaceRole,
  getWorkspaceMessageRateLimit,
  getWorkspaceRolePosition,
  isWorkspaceRole,
  parseRolePermission,
  roleHasPermissions,
  workspaceAuthorityHasPermissions,
} from "./permissions"

describe("workspace permissions", () => {
  it("recognizes only supported workspace roles", () => {
    expect(isWorkspaceRole("owner")).toBe(true)
    expect(isWorkspaceRole("admin")).toBe(true)
    expect(isWorkspaceRole("member")).toBe(true)
    expect(isWorkspaceRole("guest")).toBe(false)
  })

  it("keeps member message limits stricter than elevated roles", () => {
    expect(getWorkspaceMessageRateLimit("member")).toBe(30)
    expect(getWorkspaceMessageRateLimit("admin")).toBe(120)
    expect(getWorkspaceMessageRateLimit("owner")).toBe(120)
  })

  it("enforces workspace authority hierarchy", () => {
    expect(
      canManageWorkspaceAuthority({ role: "owner" }, { role: "admin" })
    ).toBe(true)
    expect(
      canManageWorkspaceAuthority({ role: "admin" }, { role: "member" })
    ).toBe(true)
    expect(
      canManageWorkspaceAuthority({ role: "member" }, { role: "admin" })
    ).toBe(false)
    expect(
      canManageWorkspaceAuthority({ role: "admin" }, { role: "owner" })
    ).toBe(false)
  })

  it("grants channel management permissions only to elevated roles", () => {
    expect(roleHasPermissions("admin", { channel: ["create"] })).toBe(true)
    expect(roleHasPermissions("member", { channel: ["create"] })).toBe(false)
  })

  it("grants the split resource statements to elevated roles only", () => {
    expect(roleHasPermissions("admin", { connector: ["manage"] })).toBe(true)
    expect(roleHasPermissions("admin", { customTool: ["manage"] })).toBe(true)
    expect(roleHasPermissions("owner", { billing: ["manage"] })).toBe(true)
    expect(roleHasPermissions("member", { connector: ["manage"] })).toBe(false)
    expect(roleHasPermissions("member", { webhook: ["manage"] })).toBe(false)
    expect(roleHasPermissions("member", { approval: ["resolve"] })).toBe(false)
  })

  it("does not infer ownership from the role string", () => {
    // explicit isOwner (from workspace.ownerId) bypasses everything
    expect(
      workspaceAuthorityHasPermissions(
        { role: "member", isOwner: true },
        { instructions: ["approve"] }
      )
    ).toBe(true)
    // a target is only owner-protected when isOwner is explicit
    expect(
      canManageWorkspaceAuthority(
        { role: "admin" },
        { role: "member", isOwner: true }
      )
    ).toBe(false)
    expect(
      canManageWorkspaceAuthority(
        { role: "admin", isOwner: true },
        { role: "admin" }
      )
    ).toBe(true)
  })

  it("resolves custom role permissions from grants", () => {
    const support = {
      role: "support",
      customGrants: { channel: ["update"], webhook: ["manage"] },
    }
    expect(
      workspaceAuthorityHasPermissions(support, { channel: ["update"] })
    ).toBe(true)
    expect(
      workspaceAuthorityHasPermissions(support, { webhook: ["manage"] })
    ).toBe(true)
    expect(
      workspaceAuthorityHasPermissions(support, { channel: ["delete"] })
    ).toBe(false)
    expect(
      workspaceAuthorityHasPermissions(support, { billing: ["manage"] })
    ).toBe(false)
    // unresolved custom role (deleted / dangling) has no grants
    expect(
      workspaceAuthorityHasPermissions(
        { role: "support", customGrants: null },
        { channel: ["update"] }
      )
    ).toBe(false)
  })

  it("lets static role names shadow same-named custom grants", () => {
    expect(
      workspaceAuthorityHasPermissions(
        { role: "member", customGrants: { channel: ["create"] } },
        { channel: ["create"] }
      )
    ).toBe(false)
  })

  it("slots custom roles between admin and member", () => {
    expect(getWorkspaceRolePosition("support")).toBe(15)
    expect(
      canManageWorkspaceAuthority({ role: "admin" }, { role: "support" })
    ).toBe(true)
    expect(
      canManageWorkspaceAuthority({ role: "support" }, { role: "member" })
    ).toBe(true)
    expect(
      canManageWorkspaceAuthority({ role: "support" }, { role: "admin" })
    ).toBe(false)
    expect(
      canManageWorkspaceAuthority({ role: "support" }, { role: "support" })
    ).toBe(false)
  })

  it("falls back to member-tier limits and raw labels for custom roles", () => {
    expect(getWorkspaceMessageRateLimit("support")).toBe(30)
    expect(formatWorkspaceRole("support")).toBe("support")
    expect(formatWorkspaceRole("admin")).toBe("Admin")
  })

  it("parses only well-formed role permission JSON", () => {
    expect(
      parseRolePermission('{"channel":["update"],"webhook":["manage"]}')
    ).toEqual({ channel: ["update"], webhook: ["manage"] })
    expect(parseRolePermission("{}")).toEqual({})
    expect(parseRolePermission("not json")).toBeNull()
    expect(parseRolePermission('"string"')).toBeNull()
    expect(parseRolePermission('["channel"]')).toBeNull()
    expect(parseRolePermission('{"channel":"update"}')).toBeNull()
    expect(parseRolePermission('{"channel":[1]}')).toBeNull()
  })
})
