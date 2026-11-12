import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { RealtimeHarnessCommandList } from "@repo/realtime-types"
import { useThemeColor } from "heroui-native/hooks"
import { ScrollView, Text, View } from "react-native"
import { PressableRow } from "@/components/ui/pressable-row"

// A session harness's own commands for the composer (reference/
// skills-and-commands.md): "/" as the message's first word lists its slash
// commands, "$" lists Codex's skills. The server decides what is a command,
// so typing one always worked; this is the menu web has.

export type HarnessCommandItem = {
  // What picking it writes: "/compact " or "$skill-name ".
  insert: string
  label: string
  description: string
  skill: boolean
}

const MAX_RESULTS = 20

// The command being typed, if the draft is one: a "/" word that is the whole
// draft so far (the harness takes a command only as the first word), or a
// "$" word at the end of the draft (Codex reads skills anywhere).
export function harnessCommandQuery(
  text: string,
  commands: RealtimeHarnessCommandList | null | undefined
): { sigil: "/" | "$"; query: string; items: HarnessCommandItem[] } | null {
  if (!commands) return null
  const slash = /^\/(\S*)$/.exec(text)
  const skill = slash ? null : /(?:^|\s)\$([^\s$]*)$/.exec(text)
  const sigil = slash ? "/" : skill ? "$" : null
  if (!sigil) return null
  const query = (slash?.[1] ?? skill?.[1] ?? "").toLowerCase()
  const items = (sigil === "/" ? commands.slash : commands.mentions)
    .filter((command) => command.name.toLowerCase().includes(query))
    .slice(0, MAX_RESULTS)
    .map((command) => ({
      insert: `${sigil}${command.name} `,
      label: `${sigil}${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`,
      description: command.description,
      skill: sigil === "$" || command.name.startsWith("skill:"),
    }))
  // "check /tmp" or an unknown word opens nothing.
  return items.length > 0 ? { sigil, query, items } : null
}

// The draft with the command being typed replaced by the picked one.
export function applyHarnessCommand(text: string, item: HarnessCommandItem) {
  if (item.insert.startsWith("/")) return item.insert
  return text.replace(/\$[^\s$]*$/, item.insert)
}

export function CommandSuggestionMenu({
  items,
  onSelect,
}: {
  items: HarnessCommandItem[]
  onSelect: (item: HarnessCommandItem) => void
}) {
  const muted = useThemeColor("muted")
  return (
    <View
      accessibilityLabel="Commands"
      className="absolute bottom-full left-three right-three mb-two max-h-[264px] overflow-hidden rounded-lor-md border border-border bg-overlay"
      style={{ zIndex: 20, elevation: 8 }}
    >
      <ScrollView
        contentContainerClassName="py-one"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {items.map((item) => (
          <PressableRow
            accessibilityHint={item.description}
            accessibilityLabel={item.label}
            accessibilityRole="button"
            className="mx-one min-h-12 flex-row items-center gap-three px-two py-two"
            highlightClassName="rounded-lor-sm bg-default"
            key={item.insert}
            onPress={() => onSelect(item)}
          >
            <View className="size-8 items-center justify-center rounded-lor-sm bg-default">
              <HugeiconsIcon
                color={muted}
                icon={item.skill ? BookOpen01Icon : CommandLineIcon}
                size={17}
                strokeWidth={2}
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="font-mono text-[13px] font-semibold text-foreground"
                numberOfLines={1}
              >
                {item.label}
              </Text>
              {item.description ? (
                <Text className="text-xs text-muted" numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </View>
          </PressableRow>
        ))}
      </ScrollView>
    </View>
  )
}
