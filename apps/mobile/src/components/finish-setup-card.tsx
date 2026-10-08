import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import * as SecureStore from "expo-secure-store"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { useTheme } from "@/hooks/use-theme"
import { env } from "@/lib/env"
import { openExternalUrl } from "@/lib/open-url"

const hiddenKey = (workspaceId: string) =>
  `lor.finish-setup-hidden.${workspaceId}`

// Mobile has no setup checklist, and connector sign-in only completes on the
// web, so connector managers get pointed there. The ✕ hides it on this device
// only: finishing or skipping setup on the web hides it everywhere.
export function FinishSetupCard({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const theme = useTheme()
  // null until the stored choice loads, so the card never flashes.
  const [hidden, setHidden] = useState<boolean | null>(null)

  useEffect(() => {
    setHidden(null)
    SecureStore.getItemAsync(hiddenKey(workspaceId))
      .then((value) => setHidden(value === "1"))
      .catch(() => setHidden(false))
  }, [workspaceId])

  const hide = () => {
    setHidden(true)
    SecureStore.setItemAsync(hiddenKey(workspaceId), "1").catch(() => {})
  }

  if (hidden !== false) return null

  return (
    <View className="mb-four flex-row items-start gap-two rounded-lor-md border border-border bg-surface py-three pr-two pl-four">
      <View className="min-w-0 flex-1 gap-one">
        <Text className="text-[15px] font-semibold text-foreground">
          Finish setup on the web
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted">
          Connect GitHub and Linear and invite your team.
        </Text>
        <Pressable
          accessibilityRole="link"
          className="mt-two self-start active:opacity-70"
          hitSlop={8}
          onPress={() =>
            openExternalUrl(`${env.EXPO_PUBLIC_WEB_URL}/${workspaceSlug}/setup`)
          }
        >
          <Text className="text-[13px] font-semibold text-accent">
            Open on web
          </Text>
        </Pressable>
      </View>
      <IconButton
        accessibilityLabel="Hide on this device"
        onPress={hide}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon
          color={theme.textTertiary}
          icon={Cancel01Icon}
          size={16}
        />
      </IconButton>
    </View>
  )
}
