import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  CONNECTORS,
  cleanToolDescription,
  hasUnavailableProfileSelections,
  type ProfileToolGroup,
  profileGroupNote,
  profileGroupSelection,
  profileGroupSummary,
  profileSelectedTools,
  removeUnavailableProfileSelections,
  setProfileGroupSelection,
  type ToolGroup,
  toolGroups,
} from "@repo/connectors"
import type { ProfileToolAccess, ProfileToolSelection } from "@repo/db/schema"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { ConnectorIcon, type ConnectorKey } from "@/components/connector-icon"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { Switch } from "@/components/ui/switch"

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

function CheckMark({ state }: { state: "on" | "off" | "mixed" }) {
  const accent = useThemeColor("accent")
  if (state === "off")
    return <View className="size-[19px] rounded border border-separator" />
  return (
    <SymbolView
      name={
        state === "on"
          ? {
              ios: "checkmark.square.fill",
              android: "check_box",
              web: "check_box",
            }
          : {
              ios: "minus.square.fill",
              android: "indeterminate_check_box",
              web: "indeterminate_check_box",
            }
      }
      size={19}
      tintColor={accent}
    />
  )
}

function Chevron({ open }: { open: boolean }) {
  const muted = useThemeColor("muted")
  return (
    <SymbolView
      name={
        open
          ? {
              ios: "chevron.down",
              android: "keyboard_arrow_down",
              web: "keyboard_arrow_down",
            }
          : {
              ios: "chevron.right",
              android: "keyboard_arrow_right",
              web: "keyboard_arrow_right",
            }
      }
      size={14}
      tintColor={muted}
    />
  )
}

// Read/Write groups with a group checkbox, matching the web ToolChecklist.
// Partly selected groups start open.
function ToolChecklist({
  tools,
  selected,
  providerHints,
  onChange,
}: {
  tools: ProfileToolGroup["tools"]
  selected: readonly string[]
  providerHints: boolean
  onChange: (names: string[]) => void
}) {
  const groups = toolGroups(tools, providerHints)
  const countIn = (group: ToolGroup) =>
    group.tools.filter((tool) => selected.includes(tool.name)).length
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        groups
          .filter((group) => {
            const count = countIn(group)
            return count > 0 && count < group.tools.length
          })
          .map((group) => group.key)
      )
  )
  const toggleOpen = (key: ToolGroup["key"]) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const setTools = (names: string[], on: boolean) => {
    triggerHaptic("selection")
    onChange(
      on
        ? [...new Set([...selected, ...names])]
        : selected.filter((name) => !names.includes(name))
    )
  }

  return (
    <View>
      {groups.map((group) => {
        const count = countIn(group)
        const all = count === group.tools.length
        const open = expanded.has(group.key)
        return (
          <View key={group.key} className="border-t border-separator">
            <View className="flex-row items-center gap-three">
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={group.label}
                accessibilityState={{
                  checked: all ? true : count > 0 ? "mixed" : false,
                }}
                hitSlop={8}
                onPress={() =>
                  setTools(
                    group.tools.map((tool) => tool.name),
                    !all
                  )
                }
                className="py-three active:opacity-70"
              >
                <CheckMark state={all ? "on" : count > 0 ? "mixed" : "off"} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${group.label}, ${count} of ${group.tools.length}`}
                accessibilityState={{ expanded: open }}
                onPress={() => toggleOpen(group.key)}
                className="min-h-11 flex-1 flex-row items-center gap-two active:opacity-70"
              >
                <Text className="flex-1 text-sm text-foreground">
                  {group.label}
                </Text>
                <Text className="text-xs text-muted">
                  {count} of {group.tools.length}
                </Text>
                <Chevron open={open} />
              </Pressable>
            </View>
            {open &&
              group.tools.map((tool) => {
                const checked = selected.includes(tool.name)
                const description = cleanToolDescription(tool.description)
                return (
                  <Pressable
                    key={tool.name}
                    accessibilityRole="checkbox"
                    accessibilityLabel={tool.label}
                    accessibilityState={{ checked }}
                    onPress={() => setTools([tool.name], !checked)}
                    className="ml-[31px] min-h-11 flex-row items-start gap-three border-t border-separator py-three active:opacity-70"
                  >
                    <CheckMark state={checked ? "on" : "off"} />
                    <View className="min-w-0 flex-1 gap-one">
                      <Text className="text-sm text-foreground">
                        {tool.label}
                      </Text>
                      {!!description && (
                        <Text className="text-xs text-muted" numberOfLines={2}>
                          {description}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                )
              })}
          </View>
        )
      })}
    </View>
  )
}

// Switch off = Off. Switch on = follow the workspace. Changing a checkbox
// saves an explicit custom list, which stops following new workspace tools.
function ServiceTools({
  group,
  access,
  onChange,
}: {
  group: ProfileToolGroup
  access: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
}) {
  const [open, setOpen] = useState(false)
  const selection = profileGroupSelection(access, group)
  const mode = selection?.mode ?? "workspace"
  const names = group.tools.map((tool) => tool.name)
  const selected = profileSelectedTools(names, selection)
  const expandable = mode !== "off" && group.tools.length > 0
  const summary = profileGroupSummary(group, selection)
  const select = (next: ProfileToolSelection) =>
    onChange(setProfileGroupSelection(access, group, next))

  return (
    <View className="border-b border-separator">
      <View className="flex-row items-center gap-three py-three">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${group.name}, ${summary}`}
          accessibilityState={{
            expanded: open && expandable,
            disabled: !expandable,
          }}
          disabled={!expandable}
          onPress={() => setOpen(!open)}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-three active:opacity-70"
        >
          <ProfileServiceIcon group={group} />
          <View className="min-w-0 flex-1 gap-one">
            <Text className="text-sm font-semibold text-foreground">
              {group.name}
            </Text>
            <Text className="text-xs text-muted">{summary}</Text>
          </View>
          {expandable && <Chevron open={open} />}
        </Pressable>
        <Switch
          accessibilityLabel={group.name}
          isSelected={mode !== "off"}
          onSelectedChange={(on) => {
            if (!on) setOpen(false)
            select(on ? { mode: "workspace" } : { mode: "off" })
          }}
        />
      </View>
      {open && expandable && (
        <View className="gap-three pb-three pl-[30px]">
          <ToolChecklist
            tools={group.tools}
            selected={selected}
            providerHints={group.kind === "mcpServer"}
            onChange={(tools) =>
              select({
                mode: "custom",
                tools: names.filter((name) => tools.includes(name)),
              })
            }
          />
          <Text className="text-xs text-muted">
            {profileGroupNote(group, selection)}
          </Text>
          {mode === "custom" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => select({ mode: "workspace" })}
              className="min-h-11 justify-center self-start active:opacity-70"
            >
              <Text className="text-sm font-medium text-foreground">
                Use all tools
              </Text>
            </Pressable>
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
