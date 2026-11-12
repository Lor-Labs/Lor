import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { PressableScale } from "@/components/ui/pressable-scale"
import { env } from "@/lib/env"
import { openExternalUrl } from "@/lib/open-url"

// Something that needs an account linked (a Claude subscription, a ChatGPT
// plan, GitHub). Linking happens on the web, so the notice opens the web
// app's Linked accounts settings in the browser instead of only saying so.
// Takes the workspace as a prop, not from context: it also shows inside
// bottom sheets, which render outside the workspace provider.
export function ConnectOnWebNotice({
  children,
  className,
  workspaceSlug,
}: {
  children: ReactNode
  className?: string
  workspaceSlug: string | undefined
}) {
  const accent = useThemeColor("accent")
  return (
    <View
      className={`gap-two rounded-lor-md border border-border bg-surface-secondary px-three py-three ${className ?? ""}`}
    >
      <Text className="text-[13px] leading-[18px] text-muted">{children}</Text>
      <PressableScale
        accessibilityHint="Opens Lor on the web in your browser"
        accessibilityLabel="Open Linked accounts on the web"
        accessibilityRole="link"
        className="flex-row items-center gap-one self-start"
        feedback="dim"
        onPress={() =>
          openExternalUrl(
            `${env.EXPO_PUBLIC_WEB_URL}/${workspaceSlug ?? ""}?settings=user&tab=linked-accounts`
          )
        }
      >
        <Text className="text-[13px] font-semibold text-accent">
          Open Linked accounts on the web
        </Text>
        <HugeiconsIcon
          color={accent}
          icon={ArrowUpRight01Icon}
          size={14}
          strokeWidth={2}
        />
      </PressableScale>
    </View>
  )
}
