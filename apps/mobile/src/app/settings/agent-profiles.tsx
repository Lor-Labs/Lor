import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import PencilEdit01Icon from "@hugeicons/core-free-icons/PencilEdit01Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Input } from "heroui-native/input"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { ConnectorIcon } from "@/components/connector-icon"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { api } from "@/lib/api"
import type {
  AgentProfile,
  AvailableCapability,
  MerlinCapabilityKey,
} from "@/lib/api-types"
import { confirmDiscard } from "@/lib/confirm-discard"

// Group capabilities by their connector, preserving first-seen order.
function groupByConnector(caps: AvailableCapability[]) {
  const groups: {
    connector: AvailableCapability["connector"]
    connectorLabel: string
    caps: AvailableCapability[]
  }[] = []
  for (const cap of caps) {
    const group = groups.find((g) => g.connector === cap.connector)
    if (group) group.caps.push(cap)
    else
      groups.push({
        connector: cap.connector,
        connectorLabel: cap.connectorLabel,
        caps: [cap],
      })
  }
  return groups
}

function GrantedChips({
  available,
  profile,
}: {
  available: AvailableCapability[]
  profile: AgentProfile
}) {
  const foreground = useThemeColor("foreground")
  const granted = profile.grantsAll
    ? available
    : available.filter((cap) => profile.capabilities.includes(cap.key))

  if (granted.length === 0) {
    return <Text className="text-xs text-muted">Chat & memory only</Text>
  }
  return (
    <View className="flex-row flex-wrap gap-one">
      {granted.map((cap) => (
        <View
          className="flex-row items-center gap-one rounded-lor-sm bg-surface-tertiary px-two py-one"
          key={cap.key}
        >
          <ConnectorIcon
            color={foreground}
            connector={cap.connector}
            size={13}
          />
          <Text className="text-xs text-foreground">{cap.label}</Text>
        </View>
      ))}
    </View>
  )
}

function ProfileEditor({
  available,
  onCancel,
  onSave,
  profile,
  saving,
}: {
  available: AvailableCapability[]
  onCancel: () => void
  onSave: (name: string, capabilities: MerlinCapabilityKey[]) => void
  profile?: AgentProfile
  saving: boolean
}) {
  const [foreground, accent] = useThemeColor(["foreground", "accent"])
  const [name, setName] = useState(profile?.name ?? "")
  const [selected, setSelected] = useState<Set<MerlinCapabilityKey>>(() => {
    if (!profile) return new Set()
    if (profile.grantsAll) return new Set(available.map((cap) => cap.key))
    return new Set(profile.capabilities)
  })

  const toggle = (key: MerlinCapabilityKey) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = () => {
    if (!name.trim()) return
    // Keep grants for capabilities whose connector is currently disconnected —
    // the editor can't show them, but they shouldn't be silently revoked.
    const availableKeys = new Set(available.map((cap) => cap.key))
    const preserved = (profile?.capabilities ?? []).filter(
      (key) => !availableKeys.has(key)
    )
    onSave(name.trim(), [...new Set([...selected, ...preserved])])
  }

  return (
    <View className="gap-four rounded-lor-lg bg-surface-secondary p-four">
      <Input
        maxLength={60}
        onChangeText={setName}
        placeholder="Profile name"
        value={name}
      />
      <View className="gap-three">
        <Text className="text-xs font-medium text-muted">Tools</Text>
        {available.length === 0 ? (
          <Text className="text-xs leading-4 text-muted">
            No connectors are connected yet — connect one from the web app's
            Connectors settings to grant tools.
          </Text>
        ) : (
          groupByConnector(available).map((group) => (
            <View className="gap-two" key={group.connector ?? "web"}>
              <View className="flex-row items-center gap-one">
                <ConnectorIcon
                  color={foreground}
                  connector={group.connector}
                  size={13}
                />
                <Text className="text-xs font-medium text-muted">
                  {group.connectorLabel}
                </Text>
              </View>
              {group.caps.map((cap) => {
                const isSelected = selected.has(cap.key)
                return (
                  <Pressable
                    accessibilityLabel={cap.label}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    className={`flex-row items-center gap-three rounded-lor-sm border px-three py-three active:opacity-70 ${
                      isSelected
                        ? "border-accent bg-accent-soft"
                        : "border-separator bg-surface"
                    }`}
                    key={cap.key}
                    onPress={() => toggle(cap.key)}
                  >
                    <View className="min-w-0 flex-1 gap-px">
                      <Text className="text-sm font-medium text-foreground">
                        {cap.label}
                      </Text>
                      <Text className="text-xs leading-4 text-muted">
                        {cap.description}
                      </Text>
                    </View>
                    {isSelected ? (
                      <SymbolView
                        name={{
                          ios: "checkmark.circle.fill",
                          android: "check_circle",
                          web: "check_circle",
                        }}
                        size={19}
                        tintColor={accent}
                      />
                    ) : (
                      <View className="size-[19px] rounded-full border border-separator" />
                    )}
                  </Pressable>
                )
              })}
            </View>
          ))
        )}
      </View>
      <View className="flex-row justify-end gap-two">
        <Button onPress={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button isDisabled={!name.trim() || saving} onPress={save} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
      </View>
    </View>
  )
}

export default function AgentProfilesScreen() {
  const foreground = useThemeColor("foreground")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug ?? null
  const [editingId, setEditingId] = useState<string | "new" | null>(null)

  const profilesQuery = useQuery({
    enabled: workspaceSlug !== null,
    queryKey: ["agent-profiles", workspaceSlug],
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ].$get({ param: { workspaceSlug: workspaceSlug ?? "" } })
      if (!response.ok) throw new Error("Could not load agent profiles")
      return response.json()
    },
  })
  const data = profilesQuery.data ?? null

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["agent-profiles", workspaceSlug],
    })

  const save = useMutation({
    mutationFn: async (input: {
      id?: string
      name: string
      capabilities: MerlinCapabilityKey[]
    }) => {
      const profiles = api.v1.workspaces[":workspaceSlug"]["agent-profiles"]
      const response = input.id
        ? await profiles[":profileId"].$patch({
            param: { workspaceSlug: workspaceSlug ?? "", profileId: input.id },
            json: { name: input.name, capabilities: input.capabilities },
          })
        : await profiles.$post({
            param: { workspaceSlug: workspaceSlug ?? "" },
            json: { name: input.name, capabilities: input.capabilities },
          })
      if (!response.ok) throw new Error("Could not save the profile")
    },
    onSuccess: () => {
      void invalidate()
      setEditingId(null)
      toast.show({ variant: "success", label: "Profile saved" })
    },
    onError: () => {
      toast.show({ variant: "danger", label: "Couldn't save the profile" })
    },
  })

  const remove = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await api.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ][":profileId"].$delete({
        param: { workspaceSlug: workspaceSlug ?? "", profileId },
      })
      if (!response.ok) throw new Error("Could not delete the profile")
    },
    onSuccess: () => {
      void invalidate()
      toast.show({ variant: "success", label: "Profile deleted" })
    },
    onError: () => {
      toast.show({ variant: "danger", label: "Couldn't delete the profile" })
    },
  })

  const confirmDelete = (profile: AgentProfile) => {
    Alert.alert(
      "Delete profile?",
      `Channels using “${profile.name}” will fall back to the default profile.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => remove.mutate(profile.id),
        },
      ]
    )
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back"
          isDisabled={save.isPending}
          onPress={() => {
            if (save.isPending) return
            if (editingId !== null) confirmDiscard(() => router.back())
            else router.back()
          }}
          variant="ghost"
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <Text className="flex-1 text-[17px] font-bold text-foreground">
          Agent Profiles
        </Text>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerClassName="gap-four px-four pb-eight pt-five"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-sm leading-5 text-muted">
          Profiles control which tools Merlin can use in a channel. A channel
          inherits its category's profile, then the workspace default. Merlin's
          memory and chat search are always available.
        </Text>

        {workspaceSlug === null ? (
          <StatePanel
            detail="Open a workspace and try again."
            status="danger"
            title="No workspace selected"
          />
        ) : profilesQuery.isPending ? (
          <View className="gap-three">
            <Skeleton className="h-24 rounded-lor-lg" />
            <Skeleton className="h-24 rounded-lor-lg" />
          </View>
        ) : profilesQuery.isError || !data ? (
          <StatePanel
            action={{
              label: "Try again",
              onPress: () => void profilesQuery.refetch(),
            }}
            detail="Check your connection and try again."
            status="danger"
            title="Profiles unavailable"
          />
        ) : (
          <>
            {data.profiles.map((profile) =>
              editingId === profile.id ? (
                <ProfileEditor
                  available={data.availableCapabilities}
                  key={profile.id}
                  onCancel={() => setEditingId(null)}
                  onSave={(name, capabilities) =>
                    save.mutate({ id: profile.id, name, capabilities })
                  }
                  profile={profile}
                  saving={save.isPending}
                />
              ) : (
                <View
                  className="flex-row items-start gap-three rounded-lor-lg bg-surface-secondary p-four"
                  key={profile.id}
                >
                  <View className="min-w-0 flex-1 gap-two">
                    <View className="flex-row items-center gap-two">
                      <Text
                        className="text-[15px] font-semibold text-foreground"
                        numberOfLines={1}
                      >
                        {profile.name}
                      </Text>
                      {profile.isDefault ? (
                        <View className="rounded-lor-sm bg-surface-tertiary px-two py-px">
                          <Text className="text-[11px] font-medium text-muted">
                            Default
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <GrantedChips
                      available={data.availableCapabilities}
                      profile={profile}
                    />
                  </View>
                  <View className="flex-row items-center">
                    <IconButton
                      accessibilityLabel={`Edit ${profile.name}`}
                      onPress={() => setEditingId(profile.id)}
                      variant="ghost"
                    >
                      <HugeiconsIcon
                        color={foreground}
                        icon={PencilEdit01Icon}
                        size={17}
                      />
                    </IconButton>
                    {profile.isDefault ? null : (
                      <IconButton
                        accessibilityLabel={`Delete ${profile.name}`}
                        onPress={() => confirmDelete(profile)}
                        variant="ghost"
                      >
                        <HugeiconsIcon
                          color={foreground}
                          icon={Delete02Icon}
                          size={17}
                        />
                      </IconButton>
                    )}
                  </View>
                </View>
              )
            )}
            {editingId === "new" ? (
              <ProfileEditor
                available={data.availableCapabilities}
                onCancel={() => setEditingId(null)}
                onSave={(name, capabilities) =>
                  save.mutate({ name, capabilities })
                }
                saving={save.isPending}
              />
            ) : (
              <Pressable
                accessibilityLabel="New profile"
                accessibilityRole="button"
                className="min-h-12 flex-row items-center justify-center gap-two rounded-lor-lg border border-dashed border-separator active:bg-surface-secondary"
                onPress={() => setEditingId("new")}
              >
                <HugeiconsIcon
                  color={foreground}
                  icon={PlusSignIcon}
                  size={16}
                />
                <Text className="text-sm font-medium text-foreground">
                  New profile
                </Text>
              </Pressable>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  )
}
