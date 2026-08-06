import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon"
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon"
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon"
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Image, Pressable, Text, View } from "react-native"
import {
  ConnectorIcon,
  connectorForTool,
  connectorForUrl,
} from "@/components/connector-icon"
import { MessageContent } from "@/components/message-content"
import type { MerlinToolCall } from "@/lib/merlin"
import { openExternalUrl } from "@/lib/open-url"

function builtinToolIcon(toolName: string): IconSvgElement {
  switch (toolName) {
    case "investigate_code":
      return CodeIcon
    case "search_sources":
    case "search_messages":
    case "grep":
    case "find":
      return Search01Icon
    case "search_web":
    case "fetch_web":
      return Globe02Icon
    case "fetch_source":
      return Download01Icon
    case "ls":
    case "tree":
    case "read":
      return BookOpen01Icon
    case "bash":
      return TerminalIcon
    default:
      return Wrench01Icon
  }
}

function ToolGlyph({
  toolName,
  color,
  size = 14,
}: {
  toolName: string
  color: string
  size?: number
}) {
  const connector = connectorForTool(toolName)
  if (connector) {
    return <ConnectorIcon color={color} connector={connector} size={size} />
  }
  return (
    <HugeiconsIcon color={color} icon={builtinToolIcon(toolName)} size={size} />
  )
}

function hasDetail(toolCall: MerlinToolCall) {
  return Boolean(
    toolCall.detail?.summary || (toolCall.detail?.items?.length ?? 0) > 0
  )
}

export function MerlinToolTrail({
  toolCalls,
  childrenByParent,
  streaming = false,
}: {
  toolCalls: MerlinToolCall[]
  childrenByParent?: Map<string, MerlinToolCall[]>
  streaming?: boolean
}) {
  const [muted, foreground, accent] = useThemeColor([
    "muted",
    "foreground",
    "accent",
  ])
  const [isOpen, setIsOpen] = useState(false)
  // Track only the id — the drawer re-derives its tool from the prop so it
  // keeps updating while the call streams in more detail.
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  if (toolCalls.length === 0) return null

  const selectedTool = selectedToolId
    ? (toolCalls.find((toolCall) => toolCall.toolCallId === selectedToolId) ??
      null)
    : null

  const expanded = isOpen || streaming
  const summary = streaming
    ? (toolCalls.at(-1)?.label ?? "Working…")
    : `Used ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`

  return (
    <View className="mt-one">
      <Pressable
        accessibilityLabel={summary}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-8 flex-row items-center gap-one self-start"
        onPress={() => setIsOpen((current) => !current)}
      >
        <HugeiconsIcon
          color={muted}
          icon={ArrowRight01Icon}
          size={13}
          style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
        />
        <Text className="max-w-[280px] text-xs text-muted" numberOfLines={1}>
          {summary}
        </Text>
      </Pressable>
      {expanded ? (
        <View className="ml-one gap-one border-l border-border pl-three">
          {toolCalls.map((toolCall) => {
            const drillable = hasDetail(toolCall)
            const children = childrenByParent?.get(toolCall.toolCallId) ?? []
            return (
              <View className="gap-one" key={toolCall.toolCallId}>
                <Pressable
                  accessibilityHint={
                    drillable ? "Opens the tool result drawer" : undefined
                  }
                  accessibilityLabel={toolCall.label}
                  accessibilityRole={drillable ? "button" : undefined}
                  className="min-h-8 flex-row items-center gap-two py-one"
                  disabled={!drillable}
                  onPress={() => setSelectedToolId(toolCall.toolCallId)}
                >
                  <ToolGlyph color={muted} toolName={toolCall.toolName} />
                  <Text
                    className="min-w-0 flex-1 text-xs text-muted"
                    numberOfLines={1}
                  >
                    {toolCall.label}
                  </Text>
                  {toolCall.status === "error" ? (
                    <Text className="text-xs font-semibold text-danger">
                      failed
                    </Text>
                  ) : null}
                  {drillable ? (
                    <HugeiconsIcon
                      color={muted}
                      icon={ArrowRight01Icon}
                      size={13}
                    />
                  ) : null}
                </Pressable>
                {children.length > 0 ? (
                  <View className="ml-five gap-one border-l border-border pl-three">
                    {children.map((child) => (
                      <View
                        className="min-h-7 flex-row items-center gap-two"
                        key={child.toolCallId}
                      >
                        <ToolGlyph
                          color={muted}
                          size={12}
                          toolName={child.toolName}
                        />
                        <Text
                          className="min-w-0 flex-1 text-[11px] text-muted"
                          numberOfLines={1}
                        >
                          {child.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      ) : null}

      <BottomSheet
        isOpen={selectedTool !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedToolId(null)
        }}
      >
        <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
          <BottomSheet.Overlay />
          <BottomSheet.Content snapPoints={["72%"]}>
            {selectedTool ? (
              <BottomSheetScrollView
                contentContainerStyle={{ gap: 16, paddingBottom: 32 }}
              >
                <View className="flex-row items-start gap-three px-one">
                  <View className="mt-one size-9 items-center justify-center rounded-lor-sm bg-default">
                    <ToolGlyph
                      color={foreground}
                      size={18}
                      toolName={selectedTool.toolName}
                    />
                  </View>
                  <View className="min-w-0 flex-1 gap-one">
                    <BottomSheet.Title>{selectedTool.label}</BottomSheet.Title>
                    <BottomSheet.Description>
                      {selectedTool.status === "error"
                        ? "Tool call failed"
                        : "Tool call result"}
                    </BottomSheet.Description>
                  </View>
                  <BottomSheet.Close />
                </View>
                {selectedTool.detail?.summary ? (
                  <View className="rounded-lor-sm border border-border bg-surface-secondary p-three">
                    <MessageContent
                      content={selectedTool.detail.summary}
                      mentions={[]}
                    />
                  </View>
                ) : null}
                {selectedTool.detail?.items?.map((item) => {
                  const connector = connectorForUrl(item.url)
                  return (
                    <Pressable
                      accessibilityHint={
                        item.url ? "Opens in the browser" : undefined
                      }
                      accessibilityRole={item.url ? "link" : undefined}
                      className="min-h-11 flex-row items-center gap-three rounded-lor-sm bg-default px-three py-two"
                      disabled={!item.url}
                      key={`${selectedTool.toolCallId}:${item.url ?? item.title}`}
                      onPress={() => {
                        if (item.url) openExternalUrl(item.url)
                      }}
                    >
                      {item.favicon?.startsWith("https://") ? (
                        <Image
                          source={{ uri: item.favicon }}
                          style={{ width: 16, height: 16, borderRadius: 3 }}
                        />
                      ) : connector ? (
                        <ConnectorIcon
                          color={accent}
                          connector={connector}
                          size={16}
                        />
                      ) : (
                        <HugeiconsIcon
                          color={accent}
                          icon={ExternalLinkIcon}
                          size={16}
                        />
                      )}
                      <Text
                        className="min-w-0 flex-1 text-sm font-medium text-accent"
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                    </Pressable>
                  )
                })}
                {selectedTool.status === "error" ? (
                  <Text className="text-sm text-danger">
                    This tool did not complete successfully.
                  </Text>
                ) : null}
              </BottomSheetScrollView>
            ) : null}
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </View>
  )
}
