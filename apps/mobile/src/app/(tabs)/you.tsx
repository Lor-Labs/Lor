import Constants from "expo-constants"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { type ComponentProps, type ReactNode, useState } from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { Screen } from "@/components/ui/screen"
import { useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"
import { unregisterPushToken } from "@/lib/push-notifications"

type SettingsIcon = ComponentProps<typeof SymbolView>["name"]

function SettingsRow({
  danger,
  detail,
  icon,
  label,
  onPress,
  showChevron = true,
}: {
  danger?: boolean
  detail?: string
  icon: SettingsIcon
  label: string
  onPress: () => void
  showChevron?: boolean
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-[52px] flex-row items-center gap-three px-four active:bg-surface-secondary"
      onPress={onPress}
    >
      <View className="size-8 items-center justify-center rounded-lor-sm bg-surface-secondary">
        <SymbolView
          name={icon}
          size={17}
          tintColor={danger ? theme.danger : theme.textSecondary}
        />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className={`text-[15px] font-semibold ${danger ? "text-danger" : "text-foreground"}`}
        >
          {label}
        </Text>
        {detail ? (
          <Text className="text-xs text-muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {showChevron ? (
        <SymbolView
          name={{
            ios: "chevron.right",
            android: "chevron_right",
            web: "chevron_right",
          }}
          size={14}
          tintColor={theme.textTertiary}
        />
      ) : null}
    </Pressable>
  )
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
      {children}
    </View>
  )
}

function RowSeparator() {
  return <View className="ml-[60px] h-px bg-separator" />
}

export default function YouScreen() {
  const { data: session } = authClient.useSession()
  const { avatarColor } = useWorkspace()
  const isConnected = useSocketConnected()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const user = session?.user
  if (!user) return null

  const username = user.displayUsername ?? user.username
  const version = Constants.expoConfig?.version ?? "0.1.0"

  const confirmSignOut = () => {
    Alert.alert("Log out", "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => {
          setIsSigningOut(true)
          void unregisterPushToken()
            .catch(() => {})
            .then(() => authClient.signOut())
            .then(({ error }) => {
              if (error) throw new Error(error.message ?? "Log out failed")
            })
            .catch(() => {
              Alert.alert("Log out failed", "Please try again in a moment.")
            })
            .finally(() => setIsSigningOut(false))
        },
      },
    ])
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-five px-four pb-eight pt-five"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-four px-one">
          <View>
            <Avatar
              avatarColor={avatarColor}
              image={user.image}
              name={user.name}
              size="lg"
            />
            <View className="absolute -bottom-px -right-px size-[18px] items-center justify-center rounded-full bg-background">
              <View
                className={`size-3 rounded-full ${isConnected ? "bg-success" : "bg-muted"}`}
              />
            </View>
          </View>
          <View className="min-w-0 flex-1 gap-px">
            <Text
              className="text-[22px] font-bold tracking-[-0.4px] text-foreground"
              numberOfLines={1}
            >
              {user.name}
            </Text>
            {username ? (
              <Text
                className="text-sm font-medium text-muted"
                numberOfLines={1}
              >
                @{username}
              </Text>
            ) : null}
            <Text className="text-xs text-muted" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>

        {user.status ? (
          <View className="self-start rounded-lor-sm bg-surface-secondary px-three py-two">
            <Text className="text-sm text-foreground">{user.status}</Text>
          </View>
        ) : null}

        <SettingsCard>
          <SettingsRow
            detail="Profile, username, and status"
            icon={{
              ios: "person.crop.circle",
              android: "account_circle",
              web: "account_circle",
            }}
            label="Account"
            onPress={() => router.push("/settings/account" as never)}
          />
          <RowSeparator />
          <SettingsRow
            detail="Light, dark, or system theme"
            icon={{ ios: "paintpalette", android: "palette", web: "palette" }}
            label="Appearance"
            onPress={() => router.push("/settings/appearance" as never)}
          />
          <RowSeparator />
          <SettingsRow
            detail="What you get notified about"
            icon={{
              ios: "bell.badge",
              android: "notifications",
              web: "notifications",
            }}
            label="Notifications"
            onPress={() => router.push("/settings/notifications" as never)}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            danger
            icon={{
              ios: "rectangle.portrait.and.arrow.right",
              android: "logout",
              web: "logout",
            }}
            label={isSigningOut ? "Logging out…" : "Log Out"}
            onPress={confirmSignOut}
            showChevron={false}
          />
        </SettingsCard>

        <Text className="text-center text-xs font-medium text-muted">
          Lor v{version}
        </Text>
      </ScrollView>
    </Screen>
  )
}
