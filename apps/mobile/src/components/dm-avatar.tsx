import { View } from "react-native"
import { Avatar, type AvatarSize } from "@/components/ui/avatar"
import type { DM } from "@/lib/api-types"

export function DMAvatar({
  dm,
  size = "md",
}: {
  dm: Pick<DM, "type" | "members">
  size?: AvatarSize
}) {
  const [first, second] = dm.members

  if (dm.type === "group_dm" && first && second) {
    return (
      <View className={size === "sm" ? "size-10" : "size-11"}>
        <Avatar
          className="absolute left-0 top-0"
          image={first.image}
          name={first.name}
          size="xs"
        />
        <View className="absolute bottom-0 right-0 rounded-full border-2 border-background">
          <Avatar image={second.image} name={second.name} size="xs" />
        </View>
      </View>
    )
  }

  return (
    <Avatar
      image={first?.image ?? null}
      name={first?.name ?? "Direct message"}
      size={size}
    />
  )
}
