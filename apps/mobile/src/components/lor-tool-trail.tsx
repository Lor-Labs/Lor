import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon"
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon"
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
import {
  ConnectorIcon,
  connectorForTool,
  connectorForUrl,
} from "@/components/connector-icon"
import { FileTypeIcon } from "@/components/file-type-icon"
import { MessageContent } from "@/components/message-content"
import { API_URL } from "@/lib/auth-client"
import type { LorToolCall } from "@/lib/lor"
import { openFile } from "@/lib/open-file"
import { openExternalUrl } from "@/lib/open-url"

function builtinToolIcon(toolName: string): IconSvgElement {
  switch (toolName) {
    case "search_sources":
    case "search_messages":
    case "grep":
    case "find":
    case "glob":
      return Search01Icon
    case "search_web":
    case "fetch_web":
      return Globe02Icon
    case "fetch_source":
    case "export_tool_result":
      return Download01Icon
    case "ls":
    case "read":
    case "memory_ls":
    case "memory_read":
      return BookOpen01Icon
    case "bash":
      return TerminalIcon
    case "write":
    case "edit":
    case "share_file":
    case "memory_write":
    case "memory_edit":
    case "memory_link":
      return PencilEdit02Icon
    default:
      return Wrench01Icon
  }
}

// What a tool's glyph shows: its connector's mark, or a built-in action
// glyph. Tools of one kind share it.
export function toolKind(toolName: string) {
  return connectorForTool(toolName) ?? builtinToolIcon(toolName)
}

export function ToolGlyph({
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

// Web results carry a favicon marker — load the icon through the API's
// /v1/favicon proxy by the result url's hostname (never the third-party
// favicon url directly); fall back to the connector/external-link glyph when
// the url is missing/unparseable or the proxy has no icon.
function ItemGlyph({
  item,
  color,
}: {
  item: { url?: string; favicon?: string }
  color: string
}) {
  const [failed, setFailed] = useState(false)
  let host: string | null = null
  if (item.favicon && item.url && !failed) {
    try {
      host = new URL(item.url).hostname
    } catch {
      host = null
    }
  }
  if (host) {
    return (
      <Image
        onError={() => setFailed(true)}
        source={{ uri: `${API_URL}/v1/favicon/${encodeURIComponent(host)}` }}
        style={{ width: 16, height: 16, borderRadius: 3 }}
      />
    )
  }
  const connector = connectorForUrl(item.url)
  if (connector) {
    return <ConnectorIcon color={color} connector={connector} size={16} />
  }
  return <HugeiconsIcon color={color} icon={ExternalLinkIcon} size={16} />
}

function hasDetail(toolCall: LorToolCall) {
  return Boolean(
    toolCall.detail?.summary || (toolCall.detail?.items?.length ?? 0) > 0
  )
}

type DeliveredFile = NonNullable<LorToolCall["files"]>[number]
type FileDiff = NonNullable<LorToolCall["diff"]>

// Pi labels read "<Verb> <target>" (piToolLabel); the target shows in mono
// so the verb scans. Mirrors web.
const TARGET_TOOLS = new Set(["read", "write", "edit", "ls", "bash"])
// Pi's sandbox tools as Lor calls them directly (find is exposed as glob).
const SANDBOX_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "ls",
])
function splitLabel(toolCall: LorToolCall) {
  const space = toolCall.label.indexOf(" ")
  if (!TARGET_TOOLS.has(toolCall.toolName) || space < 0) {
    return { verb: toolCall.label, target: null }
  }
  return {
    verb: toolCall.label.slice(0, space),
    target: toolCall.label.slice(space + 1),
  }
}

// A sandbox call that wrote one of the files the turn shared (shared paths
// are relative to the work folder).
function deliveredFile(path: string | null, delivered: DeliveredFile[]) {
  if (!path) return undefined
  return delivered.find(
    (file) => path === file.path || path.endsWith(`/${file.path}`)
  )
}

function diffLineClass(line: string) {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("@@")
  ) {
    return "text-muted opacity-60"
  }
  if (line.startsWith("+")) return "bg-success-soft text-success"
  if (line.startsWith("-")) return "bg-danger-soft text-danger"
  return "text-muted"
}

function DiffCounts({ diff }: { diff: FileDiff }) {
  return (
    <Text className="text-[11px] tabular-nums">
      <Text className="text-success">+{diff.additions}</Text>
      {diff.deletions > 0 ? (
        <Text className="text-danger"> −{diff.deletions}</Text>
      ) : null}
    </Text>
  )
}

// One sandbox call, flat: verb, target (or a chip for a file the turn
// shared, which opens it), diff counts. Tapping the row opens its diff or
// output. Mirrors web's SandboxRow.
function SandboxRow({
  toolCall,
  delivered,
}: {
  toolCall: LorToolCall
  delivered: DeliveredFile[]
}) {
  const muted = useThemeColor("muted")
  const [open, setOpen] = useState(false)
  const { verb, target } = splitLabel(toolCall)
  const diff = toolCall.diff
  const file = deliveredFile(diff?.path ?? target, delivered)
  const output = toolCall.detail?.summary
  const expandable = Boolean(diff?.patch || output)

  return (
    <View>
      <Pressable
        accessibilityLabel={toolCall.label}
        accessibilityRole={expandable ? "button" : undefined}
        accessibilityState={expandable ? { expanded: open } : undefined}
        className="min-h-7 flex-row items-center gap-two"
        disabled={!expandable}
        onPress={() => setOpen((current) => !current)}
      >
        <ToolGlyph color={muted} size={12} toolName={toolCall.toolName} />
        <Text className="text-[11px] text-muted">{verb}</Text>
        {file ? (
          <Pressable
            accessibilityHint="Opens the file"
            accessibilityLabel={file.path}
            accessibilityRole="button"
            className="min-w-0 shrink flex-row items-center gap-one rounded-lor-sm bg-surface-secondary px-one py-px active:bg-surface-tertiary"
            onPress={() => openFile({ artifactId: file.artifactId })}
          >
            <FileTypeIcon filename={file.path} size={14} />
            <Text
              className="min-w-0 shrink font-mono text-[11px] text-foreground"
              numberOfLines={1}
            >
              {file.path}
            </Text>
          </Pressable>
        ) : target ? (
          <Text
            className="min-w-0 shrink font-mono text-[11px] text-muted"
            numberOfLines={1}
          >
            {target}
          </Text>
        ) : null}
        {diff ? <DiffCounts diff={diff} /> : null}
        {toolCall.status === "error" ? (
          <View className="rounded-lor-sm bg-danger-soft px-one">
            <Text className="text-[11px] font-semibold text-danger">
              Failed
            </Text>
          </View>
        ) : null}
        {expandable ? (
          <HugeiconsIcon
            color={muted}
            icon={ArrowRight01Icon}
            size={12}
            style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
          />
        ) : null}
      </Pressable>
      {open ? (
        <ScrollView
          className="mb-one ml-five rounded-lor-sm border border-border bg-surface-secondary"
          nestedScrollEnabled
          style={{ maxHeight: 256 }}
        >
          {diff?.patch ? (
            <View className="py-one">
              {diff.patch.split("\n").map((line, index) => (
                <Text
                  className={`px-two font-mono text-[11px] leading-4 ${diffLineClass(line)}`}
                  // biome-ignore lint/suspicious/noArrayIndexKey: static patch lines
                  key={index}
                >
                  {line || " "}
                </Text>
              ))}
              {diff.truncated ? (
                <Text className="px-two font-mono text-[11px] text-muted opacity-60">
                  … diff truncated
                </Text>
              ) : null}
            </View>
          ) : null}
          {output ? (
            <View
              className={diff?.patch ? "border-t border-border" : undefined}
            >
              <Text
                className="p-two font-mono text-[11px] leading-4 text-muted"
                selectable
              >
                {output}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  )
}

export function LorToolTrail({
  toolCalls,
  streaming = false,
}: {
  toolCalls: LorToolCall[]
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
  // Files Lor shared this turn; a sandbox row that wrote one shows its chip.
  const shared = toolCalls.flatMap((toolCall) => toolCall.files ?? [])

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
            // Lor's own sandbox work reads as flat rows (mirrors web).
            if (SANDBOX_TOOLS.has(toolCall.toolName)) {
              return (
                <SandboxRow
                  delivered={shared}
                  key={toolCall.toolCallId}
                  toolCall={toolCall}
                />
              )
            }
            const drillable = hasDetail(toolCall)
            return (
              <Pressable
                accessibilityHint={
                  drillable ? "Opens the tool result drawer" : undefined
                }
                accessibilityLabel={toolCall.label}
                accessibilityRole={drillable ? "button" : undefined}
                className="min-h-8 flex-row items-center gap-two py-one"
                disabled={!drillable}
                key={toolCall.toolCallId}
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
                      <ItemGlyph color={accent} item={item} />
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
