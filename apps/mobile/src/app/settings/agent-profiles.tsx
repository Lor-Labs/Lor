import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import PencilEdit01Icon from "@hugeicons/core-free-icons/PencilEdit01Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  hasUnavailableProfileSelections,
  type ProfileToolGroup,
  profileGroupSelection,
  profileSelectedTools,
} from "@repo/connectors"
import type { ProfileToolAccess } from "@repo/db/schema"
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
import { ProfileToolAccessEditor } from "@/components/profile-tool-access-editor"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/context/workspace-context"
import { api } from "@/lib/api"
import type {
  AgentProfile,
  AgentProfilesResponse,
  AvailableCapability,
  LorCapabilityKey,
} from "@/lib/api-types"
import { confirmDiscard } from "@/lib/confirm-discard"

type ProfileValues = {
  name: string
  capabilities: LorCapabilityKey[]
  toolAccess: ProfileToolAccess
  customToolIds: string[]
}

function GrantedChips({
  available,
  profile,
  groups,
  tools,
}: {
  available: AvailableCapability[]
  groups: ProfileToolGroup[]
  tools: AgentProfilesResponse["availableCustomTools"]
  profile: AgentProfile
}) {
  const foreground = useThemeColor("foreground")
  const granted = profile.grantsAll
    ? available
    : available.filter((cap) => profile.capabilities.includes(cap.key))

  const services = groups
    .map((group) => {
      const selection = profileGroupSelection(profile.toolAccess, group)
      const count = profileSelectedTools(
        group.tools.map((tool) => tool.name),
        selection
      ).length
      return { group, count, limited: selection?.mode === "custom" }
    })
    .filter(({ count }) => count > 0)
  const apiTools =
    profile.grantsAll || profile.capabilities.includes("custom_tools")
      ? []
      : tools.filter((tool) => profile.customToolIds.includes(tool.id))
  if (granted.length === 0 && services.length === 0 && apiTools.length === 0) {
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
      {services.map(({ group, count, limited }) => (
        <View
          key={`${group.kind}:${group.id}`}
          className="rounded-lor-sm bg-surface-tertiary px-two py-one"
        >
          <Text className="text-xs text-foreground">
            {limited
              ? `${group.name} · ${count} ${count === 1 ? "tool" : "tools"}`
              : group.name}
          </Text>
        </View>
      ))}
      {apiTools.map((tool) => (
        <View
          key={tool.id}
          className="rounded-lor-sm bg-surface-tertiary px-two py-one"
        >
          <Text className="text-xs text-foreground">{tool.name}</Text>
        </View>
      ))}
    </View>
  )
}

function SwitchRow({
  title,
  description,
  isSelected,
  isDisabled,
  onSelectedChange,
}: {
  title: string
  description: string
  isSelected: boolean
  // Covered by the blanket API tools grant: shown on but not editable.
  isDisabled?: boolean
  onSelectedChange: () => void
}) {
  return (
    <View className="min-h-11 flex-row items-center gap-three border-b border-separator py-three">
      <View className="min-w-0 flex-1 gap-one">
        <Text className="text-sm text-foreground">{title}</Text>
        <Text className="text-xs text-muted" numberOfLines={2}>
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        isDisabled={isDisabled}
        isSelected={isSelected}
        onSelectedChange={onSelectedChange}
      />
    </View>
  )
}

function ProfileEditor({
  available,
  groups,
  tools,
  onCancel,
  onSave,
  profile,
  saving,
}: {
  available: AvailableCapability[]
  onCancel: () => void
  groups: ProfileToolGroup[]
  tools: AgentProfilesResponse["availableCustomTools"]
  onSave: (values: ProfileValues) => void
  profile?: AgentProfile
  saving: boolean
}) {
  const [name, setName] = useState(profile?.name ?? "")
  const [selected, setSelected] = useState<Set<LorCapabilityKey>>(() => {
    if (!profile) return new Set()
    if (profile.grantsAll) return new Set(available.map((cap) => cap.key))
    return new Set(
      profile.capabilities.filter((key) =>
        available.some((cap) => cap.key === key)
      )
    )
  })

  const [toolAccess, setToolAccess] = useState<ProfileToolAccess>(
    profile?.toolAccess ?? { connectors: {}, mcpServers: {} }
  )
  const [customToolIds, setCustomToolIds] = useState(
    profile?.customToolIds ?? []
  )

  const toggle = (key: LorCapabilityKey) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = () => {
    if (
      !name.trim() ||
      saving ||
      hasUnavailableProfileSelections(toolAccess, groups)
    )
      return
    onSave({
      name: name.trim(),
      capabilities: [...selected],
      toolAccess,
      customToolIds,
    })
  }

  return (
    <View
      pointerEvents={saving ? "none" : "auto"}
      className="gap-four rounded-lor-lg bg-surface-secondary p-four"
    >
      <Input
        maxLength={60}
        onChangeText={setName}
        placeholder="Profile name"
        value={name}
      />
      <View className="gap-two">
        <Text className="text-sm font-medium text-foreground">
          Connected services
        </Text>
        <Text className="text-xs text-muted">
          Choose which tools this profile can use. Approval rules still apply.
        </Text>
        <ProfileToolAccessEditor
          groups={groups}
          value={toolAccess}
          onChange={setToolAccess}
        />
      </View>
      <View className="gap-two">
        <Text className="text-sm font-medium text-foreground">
          Built-in and API tools
        </Text>
        <View>
          {available.map((cap) => (
            <SwitchRow
              key={cap.key}
              title={cap.label}
              description={cap.description}
              isSelected={selected.has(cap.key)}
              onSelectedChange={() => toggle(cap.key)}
            />
          ))}
          {tools.map((tool) => (
            <SwitchRow
              key={tool.id}
              title={tool.name}
              description={tool.description}
              isSelected={
                selected.has("custom_tools") || customToolIds.includes(tool.id)
              }
              isDisabled={selected.has("custom_tools")}
              onSelectedChange={() =>
                setCustomToolIds((previous) =>
                  previous.includes(tool.id)
                    ? previous.filter((id) => id !== tool.id)
                    : [...previous, tool.id]
                )
              }
            />
          ))}
        </View>
      </View>
      <View className="flex-row justify-end gap-two">
        <Button onPress={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          isDisabled={
            !name.trim() ||
            saving ||
            hasUnavailableProfileSelections(toolAccess, groups)
          }
          onPress={save}
          size="sm"
        >
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
    mutationFn: async (input: ProfileValues & { id?: string }) => {
      const profiles = api.v1.workspaces[":workspaceSlug"]["agent-profiles"]
      const response = input.id
        ? await profiles[":profileId"].$patch({
            param: { workspaceSlug: workspaceSlug ?? "", profileId: input.id },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              toolAccess: input.toolAccess,
              customToolIds: input.customToolIds,
            },
          })
        : await profiles.$post({
            param: { workspaceSlug: workspaceSlug ?? "" },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              toolAccess: input.toolAccess,
              customToolIds: input.customToolIds,
            },
          })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(
          "message" in error ? error.message : "Could not save the profile"
        )
      }
    },
    onSuccess: () => {
      void invalidate()
      setEditingId(null)
      toast.show({ variant: "success", label: "Profile saved" })
    },
    onError: (error) => {
      void invalidate()
      toast.show({ variant: "danger", label: error.message })
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
          Profiles control which tools Lor can use in a channel. Channels use
          the default profile unless you pick another in channel or category
          settings.
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
                  groups={data.availableToolGroups}
                  tools={data.availableCustomTools}
                  key={profile.id}
                  onCancel={() => setEditingId(null)}
                  onSave={(values) =>
                    save.mutate({ id: profile.id, ...values })
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
                      groups={data.availableToolGroups}
                      tools={data.availableCustomTools}
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
                groups={data.availableToolGroups}
                tools={data.availableCustomTools}
                onCancel={() => setEditingId(null)}
                onSave={(values) => save.mutate(values)}
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
