import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  CONNECTORS,
  hasUnavailableProfileSelections,
  PROFILE_TOOL_MODES,
  type ProfileToolGroup,
  profileGroupSelection,
  profileGroupSummary,
  profileSelectedTools,
  removeUnavailableProfileSelections,
  setProfileGroupSelection,
} from "@repo/connectors"
import type { ProfileToolAccess } from "@repo/db/schema"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { ConnectorIcon, type ConnectorKey } from "@/components/connector-icon"
import { Button } from "@/components/ui/button"

export function ProfileServiceIcon({ group }: { group: ProfileToolGroup }) {
  const foreground = useThemeColor("foreground")
  return group.kind === "connector" && Object.hasOwn(CONNECTORS, group.id) ? (
    <ConnectorIcon
      connector={group.id as ConnectorKey}
      color={foreground}
      size={18}
    />
  ) : (
    <HugeiconsIcon icon={CloudServerIcon} color={foreground} size={18} />
  )
}

function ServiceTools({
  group,
  access,
  onChange,
}: {
  group: ProfileToolGroup
  access: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [foreground, accent] = useThemeColor(["foreground", "accent"])
  const selection = profileGroupSelection(access, group)
  const mode = selection?.mode ?? "workspace"
  const selected = profileSelectedTools(
    group.tools.map((tool) => tool.name),
    selection
  )
  return (
    <View className="gap-three border-b border-separator py-four">
      <View className="flex-row items-center gap-two">
        <ProfileServiceIcon group={group} />
        <Text className="flex-1 text-sm font-semibold text-foreground">
          {group.name}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.name}: ${PROFILE_TOOL_MODES.find((item) => item.value === mode)?.label}`}
        accessibilityState={{ expanded: choosing }}
        onPress={() => setChoosing(!choosing)}
        className="min-h-11 flex-row items-center justify-between rounded-lor-sm border border-separator px-three py-two active:opacity-70"
      >
        <Text className="text-sm text-foreground">
          {PROFILE_TOOL_MODES.find((item) => item.value === mode)?.label}
        </Text>
        <SymbolView
          name={{
            ios: "chevron.down",
            android: "keyboard_arrow_down",
            web: "keyboard_arrow_down",
          }}
          size={16}
          tintColor={foreground}
        />
      </Pressable>
      {choosing && (
        <View className="gap-one rounded-lor-sm bg-surface p-two">
          {PROFILE_TOOL_MODES.map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === item.value }}
              onPress={() => {
                onChange(
                  setProfileGroupSelection(
                    access,
                    group,
                    item.value === "custom"
                      ? { mode: "custom", tools: selected }
                      : { mode: item.value }
                  )
                )
                setChoosing(false)
              }}
              className="min-h-11 flex-row items-center justify-between rounded-lor-sm px-two py-two active:bg-surface-tertiary"
            >
              <Text className="text-sm text-foreground">{item.label}</Text>
              {mode === item.value && (
                <SymbolView
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  size={16}
                  tintColor={accent}
                />
              )}
            </Pressable>
          ))}
        </View>
      )}
      <Text className="text-xs text-muted">
        {profileGroupSummary(group, selection)}
        {mode === "workspace"
          ? ". Follows workspace changes, including tools enabled later."
          : mode === "custom"
            ? ". Newly enabled tools stay off."
            : ""}
      </Text>
      {mode === "custom" && (
        <View className="gap-one">
          {group.tools.map((tool) => (
            <Pressable
              key={tool.name}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected.includes(tool.name) }}
              accessibilityLabel={`${tool.label}${tool.readOnlyHint === true ? ", Read only" : ""}`}
              onPress={() =>
                onChange(
                  setProfileGroupSelection(access, group, {
                    mode: "custom",
                    tools: selected.includes(tool.name)
                      ? selected.filter((name) => name !== tool.name)
                      : [...selected, tool.name],
                  })
                )
              }
              className="min-h-11 flex-row items-start gap-two rounded-lor-sm px-two py-three active:bg-surface-tertiary"
            >
              {selected.includes(tool.name) ? (
                <SymbolView
                  name={{
                    ios: "checkmark.square.fill",
                    android: "check_box",
                    web: "check_box",
                  }}
                  size={19}
                  tintColor={accent}
                />
              ) : (
                <View className="size-[19px] rounded border border-separator" />
              )}
              <View className="min-w-0 flex-1 gap-one">
                <Text className="text-sm text-foreground">{tool.label}</Text>
                {tool.readOnlyHint === true && (
                  <Text className="text-xs text-muted">Read only</Text>
                )}
                {!!tool.description && (
                  <Text className="text-xs text-muted">{tool.description}</Text>
                )}
              </View>
            </Pressable>
          ))}
          {group.tools.length === 0 && (
            <Text className="text-xs text-muted">
              No tools are enabled for this service in the workspace.
            </Text>
          )}
        </View>
      )}
    </View>
  )
}

export function ProfileToolAccessEditor({
  groups,
  value,
  onChange,
}: {
  groups: ProfileToolGroup[]
  value: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
}) {
  return (
    <View>
      {hasUnavailableProfileSelections(value, groups) && (
        <View className="gap-two rounded-lor-sm border border-separator p-three">
          <Text className="text-sm text-foreground">
            Some saved services or tools are no longer available. Remove those
            selections before saving. Removed services will follow workspace
            tools if connected again.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={() =>
              onChange(removeUnavailableProfileSelections(value, groups))
            }
          >
            Remove unavailable selections
          </Button>
        </View>
      )}
      {groups.map((group) => (
        <ServiceTools
          key={`${group.kind}:${group.id}`}
          group={group}
          access={value}
          onChange={onChange}
        />
      ))}
      {groups.length === 0 && (
        <Text className="py-three text-sm text-muted">
          No services connected yet. This profile will use their workspace tools
          when you connect them.
        </Text>
      )}
    </View>
  )
}
