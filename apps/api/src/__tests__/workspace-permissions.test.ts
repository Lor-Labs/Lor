import { HTTPException } from "hono/http-exception"
import { describe, expect, it } from "vitest"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
  toWorkspaceAuthority,
} from "@/lib/permissions"

const OWNER_ID = "00000000-0000-4000-8000-0000000000aa"
const MEMBER_ID = "00000000-0000-4000-8000-0000000000bb"

describe("toWorkspaceAuthority", () => {
  it("derives isOwner from workspace.ownerId only", () => {
    const authority = toWorkspaceAuthority(
      { role: "member", userId: OWNER_ID },
      { ownerId: OWNER_ID }
    )
    expect(authority.isOwner).toBe(true)

    const spoofed = toWorkspaceAuthority(
      { role: "owner", userId: MEMBER_ID },
      { ownerId: OWNER_ID }
    )
    expect(spoofed.isOwner).toBe(false)
  })

  it("keeps custom grants only for non-static roles", () => {
    const grants = { webhook: ["manage"] }
    expect(
      toWorkspaceAuthority(
        { role: "support", userId: MEMBER_ID },
        { ownerId: OWNER_ID },
        grants
      ).customGrants
    ).toEqual(grants)
    expect(
      toWorkspaceAuthority(
        { role: "member", userId: MEMBER_ID },
        { ownerId: OWNER_ID },
        grants
      ).customGrants
    ).toBeNull()
  })

  it("does not throw on unknown role strings", () => {
    const authority = toWorkspaceAuthority(
      { role: "deleted-role", userId: MEMBER_ID },
      { ownerId: OWNER_ID }
    )
    expect(authority.customGrants).toBeNull()
    expect(hasWorkspaceAuthority(authority, { channel: ["update"] })).toBe(
      false
    )
  })
})

describe("assertWorkspaceAuthority", () => {
  it("throws 403 when the permission is missing", () => {
    expect(() =>
      assertWorkspaceAuthority(
        { role: "member", isOwner: false },
        { channel: ["update"] }
      )
    ).toThrowError(HTTPException)
    // dangling custom role (deleted from workspace_role) has no grants
    expect(() =>
      assertWorkspaceAuthority(
        { role: "support", isOwner: false, customGrants: null },
        { channel: ["update"] }
      )
    ).toThrowError(HTTPException)
  })

  it("passes for owners, static grants, and custom grants", () => {
    expect(() =>
      assertWorkspaceAuthority(
        { role: "member", isOwner: true },
        { billing: ["manage"] }
      )
    ).not.toThrow()
    expect(() =>
      assertWorkspaceAuthority(
        { role: "admin", isOwner: false },
        { connector: ["manage"] }
      )
    ).not.toThrow()
    expect(() =>
      assertWorkspaceAuthority(
        {
          role: "support",
          isOwner: false,
          customGrants: { webhook: ["manage"] },
        },
        { webhook: ["manage"] }
      )
    ).not.toThrow()
  })

  it("requires every requested action, across resources", () => {
    const authority = {
      role: "support",
      isOwner: false,
      customGrants: { webhook: ["manage"], channel: ["create"] },
    }
    expect(() =>
      assertWorkspaceAuthority(authority, {
        webhook: ["manage"],
        channel: ["create"],
      })
    ).not.toThrow()
    expect(() =>
      assertWorkspaceAuthority(authority, {
        webhook: ["manage"],
        channel: ["delete"],
      })
    ).toThrowError(HTTPException)
  })
})
