import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import { MessageComposer } from "@/components/message-composer"
import { messageDisplayName } from "@/components/message-row"
import { PickerSheet } from "@/components/picker-sheet"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { Tabs } from "@/components/ui/tabs"
import { LorMark } from "@/components/voice/lor-window"
import { useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import {
  branchesQueryOptions,
  codeTargetNote,
  HARNESS_OPTIONS,
  useCodeTarget,
  useSessionHarness,
  useSessionMode,
} from "@/hooks/use-code-target"
import { usePersonalAccounts } from "@/hooks/use-personal-accounts"
import { useSendNewSession } from "@/hooks/use-session-start"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { HARNESS_LABELS } from "@/lib/harness"
import { toSearchPreviewText } from "@/lib/message-markdown"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels"

type ChannelOption = { id: string; name: string | null }

const EXAMPLES_DISMISSED_KEY = "lor.new-session-examples-dismissed"

function sessionExamples(channelName: string) {
  return [
    `Summarize what #${channelName} decided this week`,
    "Turn our latest discussion into a list of next steps",
    "What can you help our team with?",
  ]
}

// An empty session: a prompt with the channel it will live in, preselected
// from where the person came from and changeable before sending. Mirrors
// web's new-session-view.tsx.
export default function NewSessionScreen() {
  const params = useLocalSearchParams<{
    channelId?: string
    aboutMessageId?: string
    draft?: string
  }>()
  const { workspace } = useWorkspace()
  const foreground = useThemeColor("foreground")
  const { data: channels, isPending } = useQuery(
    workspaceChannelsQueryOptions(workspace?.slug ?? "")
  )
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null)
  const options: ChannelOption[] = channels ? openTextChannels(channels) : []
  // A session's context must come from its own channel, so asking about a
  // message fixes the channel to that message's.
  const preferred = (
    params.aboutMessageId
      ? [params.channelId]
      : [pickedChannelId, params.channelId]
  ).find((id) => options.some((option) => option.id === id))
  const channel = params.aboutMessageId
    ? options.find((option) => option.id === preferred)
    : (options.find((option) => option.id === preferred) ?? options[0])

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
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
        <Text className="text-[17px] font-bold tracking-[-0.2px] text-foreground">
          New session
        </Text>
      </View>
      {channel ? (
        <NewSessionComposer
          aboutMessageId={params.aboutMessageId}
          channel={channel}
          draft={params.draft}
          onPickChannel={setPickedChannelId}
          options={options}
        />
      ) : isPending ? (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading channels" />
        </View>
      ) : (
        <StatePanel
          className="flex-1"
          detail="Sessions live in a text channel."
          title="Create a channel to start a session"
        />
      )}
    </Screen>
  )
}

function NewSessionComposer({
  channel,
  options,
  onPickChannel,
  aboutMessageId,
  draft,
}: {
  channel: ChannelOption
  options: ChannelOption[]
  onPickChannel: (channelId: string) => void
  aboutMessageId?: string
  draft?: string
}) {
  const muted = useThemeColor("muted")
  const queryClient = useQueryClient()
  const isConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { data: auth } = authClient.useSession()
  const [sheet, setSheet] = useState<
    "channel" | "repo" | "branch" | "harness" | null
  >(null)
  const [isSending, setIsSending] = useState(false)
  const workspaceSlug = workspace?.slug ?? ""
  const [mode, setMode] = useSessionMode()
  const code = useCodeTarget({
    workspaceSlug,
    channelId: channel.id,
    enabled: mode === "code",
  })
  // Claude Code runs on the starter's own Claude subscription; connecting
  // it is on web for now.
  const [harness, setHarness] = useSessionHarness()
  const claudeCode = mode === "code" && harness === "claude_code"
  const { data: accounts } = usePersonalAccounts(claudeCode)
  // Unknown while the accounts load.
  const needsClaude = claudeCode && accounts?.claude.account === null
  const [branchQuery, setBranchQuery] = useState("")
  const [debouncedBranchQuery, setDebouncedBranchQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBranchQuery(branchQuery), 200)
    return () => clearTimeout(timer)
  }, [branchQuery])
  const branches = useQuery({
    ...branchesQueryOptions(
      workspaceSlug,
      channel.id,
      code.repo,
      debouncedBranchQuery
    ),
    enabled: sheet === "branch" && Boolean(code.repo),
    placeholderData: (previous) => previous,
  })
  // Picking an example remounts the composer with it as the draft.
  const [prefill, setPrefill] = useState({ key: 0, text: draft ?? "" })
  const send = useSendNewSession(channel)
  const mentions = useWorkspaceMentionCandidates({
    workspaceSlug: workspace?.slug ?? "",
    currentUserId: auth?.user.id,
    broadcasts: false,
  })
  const channelName = channel.name ?? "channel"
  // The asked-about message, from the channel feed when it is loaded.
  const aboutMessage = aboutMessageId
    ? queryClient
        .getQueryData<Message[]>(["messages", channel.id])
        ?.find((message) => message.id === aboutMessageId)
    : undefined

  const accessory = (
    <View className="mb-two gap-two">
      <Tabs
        className="self-start"
        onValueChange={(value) => setMode(value === "code" ? "code" : "chat")}
        value={mode}
      >
        <Tabs.List>
          <Tabs.Indicator />
          <Tabs.Trigger value="chat">
            <Tabs.Label>Chat</Tabs.Label>
          </Tabs.Trigger>
          <Tabs.Trigger value="code">
            <Tabs.Label>Code</Tabs.Label>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
      {needsClaude ? (
        <View className="rounded-lor-sm border border-border bg-surface-secondary px-three py-two">
          <Text className="text-[13px] text-muted">
            Claude Code runs on your own Claude subscription. Connect it in Lor
            on the web or desktop, or pick another agent.
          </Text>
        </View>
      ) : null}
      {aboutMessageId ? (
        <View className="min-h-11 flex-row items-center gap-two rounded-lor-sm border border-border px-three">
          <Text className="text-sm text-muted">About</Text>
          <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
            {aboutMessage ? (
              <>
                <Text className="font-medium text-foreground">
                  {messageDisplayName(aboutMessage)}
                </Text>{" "}
                <Text className="text-muted">
                  {toSearchPreviewText(
                    aboutMessage.content,
                    aboutMessage.mentions
                  )}
                </Text>
              </>
            ) : (
              <Text className="text-muted">a message in #{channelName}</Text>
            )}
          </Text>
          <IconButton
            accessibilityLabel="Remove the attached message"
            onPress={() => router.setParams({ aboutMessageId: undefined })}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon color={muted} icon={Cancel01Icon} size={14} />
          </IconButton>
        </View>
      ) : null}
      <View className="flex-row items-center gap-one">
        <LorMark size={14} />
        <Text className="text-[13px] text-muted">New session in</Text>
        {aboutMessageId ? (
          <Text className="text-[13px] font-semibold text-accent">
            #{channelName}
          </Text>
        ) : (
          <Pressable
            accessibilityHint="Chooses the channel the session lives in"
            accessibilityRole="button"
            className="min-h-8 flex-row items-center gap-one rounded-lor-sm px-one active:bg-accent-soft"
            hitSlop={6}
            onPress={() => setSheet("channel")}
          >
            <Text className="text-[13px] font-semibold text-accent">
              #{channelName}
            </Text>
            <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
          </Pressable>
        )}
      </View>
      {mode === "code" ? (
        <View className="flex-row flex-wrap items-center gap-one">
          {code.status === "ready" && code.repo ? (
            <>
              <Text className="text-[13px] text-muted">on</Text>
              <TargetChip
                hint="Chooses the repository the session works in"
                icon={GithubIcon}
                label={code.repo}
                onPress={() => setSheet("repo")}
              />
              {code.branch ? (
                <TargetChip
                  hint="Chooses the branch the session starts from"
                  icon={GitBranchIcon}
                  label={code.branch}
                  onPress={() => setSheet("branch")}
                />
              ) : (
                <Spinner size="sm" />
              )}
            </>
          ) : (
            <Text className="text-[13px] text-muted">
              {codeTargetNote(code.status)}
            </Text>
          )}
          <Text className="text-[13px] text-muted">with</Text>
          <TargetChip
            hint="Chooses the agent that runs the session"
            label={HARNESS_LABELS[harness]}
            onPress={() => setSheet("harness")}
          />
        </View>
      ) : null}
    </View>
  )

  return (
    <>
      <ChatKeyboardLayout
        renderComposer={({ inputNativeID, onCustomInputViewChange }) => (
          <MessageComposer
            accessibilityLabel="Ask Lor"
            channelId={channel.id}
            channelName={channelName}
            initialDraft={prefill.text}
            inputNativeID={inputNativeID}
            isConnected={isConnected}
            isMentionCandidatesLoading={mentions.isLoading}
            isSending={isSending}
            key={prefill.key}
            mentionCandidates={mentions.candidates}
            mentionCandidatesError={mentions.error}
            onCustomInputViewChange={onCustomInputViewChange}
            onSend={async (content, attachments) => {
              setIsSending(true)
              try {
                await send(
                  content,
                  attachments,
                  aboutMessageId,
                  mode === "code" && code.target
                    ? { ...code.target, harness }
                    : undefined
                )
              } finally {
                setIsSending(false)
              }
            }}
            placeholder={
              mode === "code" ? "Ask Lor to work on the code…" : "Ask Lor…"
            }
            sendBlocked={(mode === "code" && !code.target) || needsClaude}
            topAccessory={accessory}
          />
        )}
        renderMessageList={() => (
          <View className="flex-1 justify-end px-four pb-two">
            <View
              accessibilityElementsHidden
              className="flex-1 items-center justify-center opacity-[0.06]"
              importantForAccessibility="no-hide-descendants"
            >
              <LorMark size={160} />
            </View>
            {aboutMessageId ? null : (
              <SessionExamples
                examples={sessionExamples(channelName)}
                onPick={(text) =>
                  setPrefill((current) => ({ key: current.key + 1, text }))
                }
              />
            )}
          </View>
        )}
      />
      <ChannelPickerSheet
        isOpen={sheet === "channel"}
        onOpenChange={(open) => setSheet(open ? "channel" : null)}
        onPick={(channelId) => {
          onPickChannel(channelId)
          setSheet(null)
        }}
        options={options}
        selectedId={channel.id}
      />
      <PickerSheet
        emptyText="No repositories found"
        isOpen={sheet === "repo"}
        onOpenChange={(open) => setSheet(open ? "repo" : null)}
        onPick={(repo) => {
          code.pickRepo(repo)
          setSheet(null)
        }}
        options={code.repos.map((repo) => ({ value: repo, label: repo }))}
        search={{ placeholder: "Find a repository" }}
        selected={code.repo}
        title="Repository"
      />
      <PickerSheet
        emptyText="No branches found"
        isOpen={sheet === "branch"}
        loading={branches.isFetching}
        onOpenChange={(open) => setSheet(open ? "branch" : null)}
        onPick={(branch) => {
          code.pickBranch(branch)
          setSheet(null)
        }}
        options={(
          branches.data?.branches ?? (code.branch ? [code.branch] : [])
        ).map((branch) => ({
          value: branch,
          label: branch,
          badge: branch === code.defaultBranch ? "default" : null,
        }))}
        search={{ placeholder: "Find a branch", onQueryChange: setBranchQuery }}
        selected={code.branch}
        title="Branch"
      />
      <PickerSheet
        isOpen={sheet === "harness"}
        onOpenChange={(open) => setSheet(open ? "harness" : null)}
        onPick={(value) => {
          const next = HARNESS_OPTIONS.find((option) => option.value === value)
          if (next) setHarness(next.value)
          setSheet(null)
        }}
        options={HARNESS_OPTIONS}
        selected={harness}
        title="Agent"
      />
    </>
  )
}

// A pick in the destination line (repo, branch, agent), styled like the
// channel's.
function TargetChip({
  label,
  icon,
  hint,
  onPress,
}: {
  label: string
  icon?: IconSvgElement
  hint: string
  onPress: () => void
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityRole="button"
      className="min-h-8 max-w-full flex-row items-center gap-one rounded-lor-sm px-one active:bg-accent-soft"
      hitSlop={6}
      onPress={onPress}
    >
      {icon ? (
        <HugeiconsIcon color={accent} icon={icon} size={13} strokeWidth={2} />
      ) : null}
      <Text
        className="shrink text-[13px] font-semibold text-accent"
        numberOfLines={1}
      >
        {label}
      </Text>
      <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
    </Pressable>
  )
}

function SessionExamples({
  examples,
  onPick,
}: {
  examples: string[]
  onPick: (text: string) => void
}) {
  const muted = useThemeColor("muted")
  const [dismissed, setDismissed] = useState(() => {
    try {
      return SecureStore.getItem(EXAMPLES_DISMISSED_KEY) === "true"
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  if (dismissed) return null

  const dismiss = () => {
    try {
      SecureStore.setItem(EXAMPLES_DISMISSED_KEY, "true")
    } catch {
      // Hidden until the app restarts; persistence is best-effort.
    }
    setDismissed(true)
  }

  return (
    <View>
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="min-h-9 justify-center active:opacity-60"
          onPress={() => setOpen((current) => !current)}
        >
          <Text className="text-sm text-muted">
            Get started with some examples
          </Text>
        </Pressable>
        <IconButton
          accessibilityLabel="Hide examples"
          onPress={dismiss}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon color={muted} icon={Cancel01Icon} size={14} />
        </IconButton>
      </View>
      {open
        ? examples.map((example) => (
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-lor-sm px-three active:bg-surface-secondary"
              key={example}
              onPress={() => {
                onPick(example)
                setOpen(false)
              }}
            >
              <Text className="text-[15px] text-foreground">{example}</Text>
            </Pressable>
          ))
        : null}
    </View>
  )
}

function ChannelPickerSheet({
  isOpen,
  onOpenChange,
  onPick,
  options,
  selectedId,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onPick: (channelId: string) => void
  options: ChannelOption[]
  selectedId: string
}) {
  const accent = useThemeColor("accent")
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          // The composer's keyboard would cover the list.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["55%"]}
        >
          <View className="flex-row items-center px-one pb-three">
            <BottomSheet.Title className="flex-1">Channel</BottomSheet.Title>
            <BottomSheet.Close />
          </View>
          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: option.id === selectedId }}
                className="min-h-12 flex-row items-center gap-two rounded-lor-sm px-three active:bg-surface-secondary"
                key={option.id}
                onPress={() => onPick(option.id)}
              >
                <Text
                  className="min-w-0 flex-1 text-[15px] text-foreground"
                  numberOfLines={1}
                >
                  # {option.name}
                </Text>
                {option.id === selectedId ? (
                  <HugeiconsIcon color={accent} icon={Tick02Icon} size={18} />
                ) : null}
              </Pressable>
            ))}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
