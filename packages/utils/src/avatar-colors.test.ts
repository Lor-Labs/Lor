import { describe, expect, it } from "vitest"
import {
  AVATAR_COLORS,
  avatarColorFromSeed,
  getAvatarColorStyle,
  getAvatarInitials,
  pickWorkspaceAvatarColor,
} from "./avatar-colors"

describe("workspace avatar colors", () => {
  it("uses every palette color before repeating", () => {
    const assigned: string[] = []
    for (let index = 0; index < AVATAR_COLORS.length; index += 1) {
      assigned.push(
        pickWorkspaceAvatarColor(assigned, `workspace:user-${index}`)
      )
    }

    expect(new Set(assigned)).toHaveLength(AVATAR_COLORS.length)
  })

  it("keeps assignments balanced after several cycles", () => {
    const assigned: string[] = []
    for (let index = 0; index < AVATAR_COLORS.length * 4 + 5; index += 1) {
      assigned.push(
        pickWorkspaceAvatarColor(assigned, `workspace:user-${index}`)
      )
    }

    const counts = AVATAR_COLORS.map(
      (color) =>
        assigned.filter((assignedColor) => assignedColor === color).length
    )
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it("is deterministic for fallback surfaces", () => {
    expect(avatarColorFromSeed("jacob")).toBe(avatarColorFromSeed("jacob"))
    expect(getAvatarColorStyle("not-a-color", "jacob")).toEqual(
      getAvatarColorStyle(null, "jacob")
    )
  })

  it("uses two letters for both full names and single-token handles", () => {
    expect(getAvatarInitials("Alex Doananco")).toBe("AD")
    expect(getAvatarInitials("doananco")).toBe("DO")
    expect(getAvatarInitials("  ")).toBe("?")
  })
})
