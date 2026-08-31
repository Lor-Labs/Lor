import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describe, expect, it } from "vitest"
import {
  assertWorkspaceAuthority,
  hasWorkspacePermission,
  toWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppBindings } from "@/lib/types/app-types"
import { requireWorkspacePermission } from "@/middleware/require-workspace-permission"

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
    expect(
      hasWorkspacePermission(
        { role: "deleted-role", userId: MEMBER_ID },
        { ownerId: OWNER_ID },
        { channel: ["update"] }
      )
    ).toBe(false)
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
})

describe("requireWorkspacePermission middleware", () => {
  function buildApp(authority: AppBindings["Variables"]["authority"] | null) {
    const app = new Hono<AppBindings>()
    app.use("*", async (c, next) => {
      if (authority) c.set("authority", authority)
      await next()
    })
    app.get("/gated", requireWorkspacePermission("webhook", ["manage"]), (c) =>
      c.json({ ok: true })
    )
    app.onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse()
      return c.json({ ok: false }, 500)
    })
    return app
  }

  it("allows a custom role holding the grant", async () => {
    const app = buildApp({
      role: "support",
      isOwner: false,
      customGrants: { webhook: ["manage"] },
    })
    const res = await app.request("/gated")
    expect(res.status).toBe(200)
  })

  it("rejects a member without the grant", async () => {
    const app = buildApp({ role: "member", isOwner: false })
    const res = await app.request("/gated")
    expect(res.status).toBe(403)
  })

  it("rejects a dangling custom role", async () => {
    const app = buildApp({
      role: "deleted-role",
      isOwner: false,
      customGrants: null,
    })
    const res = await app.request("/gated")
    expect(res.status).toBe(403)
  })

  it("allows the workspace owner unconditionally", async () => {
    const app = buildApp({ role: "member", isOwner: true })
    const res = await app.request("/gated")
    expect(res.status).toBe(200)
  })

  it("fails closed when authority was never resolved", async () => {
    const app = buildApp(null)
    const res = await app.request("/gated")
    expect(res.status).toBe(500)
  })
})
