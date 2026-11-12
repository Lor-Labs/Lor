import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { isValidNewBranchName } from "@repo/utils/github"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import {
  ClaudeCodeModePicker,
  useClaudeCodeMode,
} from "@/components/claude-code-mode-picker"
import { ConnectOnWebNotice } from "@/components/connect-on-web-notice"
import { MessageComposer } from "@/components/message-composer"
import { messageDisplayName } from "@/components/message-row"
import { ModelPicker } from "@/components/model-picker"
import { PickerSheet } from "@/components/picker-sheet"
import { TargetChip } from "@/components/target-chip"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { Tabs } from "@/components/ui/tabs"
import { LorMark } from "@/components/voice/lor-window"
import { useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useModelChoice } from "@/hooks/use-agent-models"
import {
  branchesQueryOptions,
  codeTargetNote,
  type SessionMode,
  useCodeTarget,
  useHarnessOptions,
  useSessionHarness,
  useSessionMode,
} from "@/hooks/use-code-target"
import { useCodeEnvironment } from "@/hooks/use-environments"
import { usePersonalAccounts } from "@/hooks/use-personal-accounts"
import { useSendNewSession } from "@/hooks/use-session-start"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { toSearchPreviewText } from "@/lib/message-markdown"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels"

type ChannelOption = { id: string; name: string | null }

// The environment sheet's value for "no environment".
const NO_ENVIRONMENT = "none"
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
  const [mode, setMode] = useSessionMode()
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
        <Text className="min-w-0 flex-1 text-[17px] font-bold tracking-[-0.2px] text-foreground">
          New session
        </Text>
        {/* The session's kind sits with the title; what it runs in and on is
            picked above the composer. */}
        <Tabs
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
      </View>
      {channel ? (
        <NewSessionComposer
          aboutMessageId={params.aboutMessageId}
          channel={channel}
          draft={params.draft}
          mode={mode}
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
  mode,
}: {
  channel: ChannelOption
  options: ChannelOption[]
  onPickChannel: (channelId: string) => void
  aboutMessageId?: string
  draft?: string
  mode: SessionMode
}) {
  const muted = useThemeColor("muted")
  const queryClient = useQueryClient()
  const isConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { data: auth } = authClient.useSession()
  const [sheet, setSheet] = useState<
    "channel" | "repo" | "branch" | "base" | "environment" | null
  >(null)
  const [isSending, setIsSending] = useState(false)
  const workspaceSlug = workspace?.slug ?? ""
  const code = useCodeTarget({
    workspaceSlug,
    channelId: channel.id,
    enabled: mode === "code",
  })
  // Which environment's env files the session writes, per repo.
  const environment = useCodeEnvironment(
    workspaceSlug,
    code.repo,
    mode === "code"
  )
  // Claude Code and Codex run on the starter's own Claude subscription or
  // ChatGPT plan; connecting them is on web for now.
  const [harness, setHarness] = useSessionHarness()
  const harnessOptions = useHarnessOptions()
  const claudeCode = mode === "code" && harness === "claude_code"
  // A chat session always runs on Lor's own agent.
  const modelChoice = useModelChoice(mode === "code" ? harness : "pi", {
    workspaceSlug,
  })
  const codex = mode === "code" && harness === "codex"
  const { data: accounts } = usePersonalAccounts(claudeCode || codex)
  // Unknown while the accounts load.
  const needsClaude = claudeCode && accounts?.claude.account === null
  const needsChatgpt = codex && accounts?.chatgpt.account === null
  const claudeCodeMode = useClaudeCodeMode()
  const [branchQuery, setBranchQuery] = useState("")
  const [debouncedBranchQuery, setDebouncedBranchQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBranchQuery(branchQuery), 200)
    return () => clearTimeout(timer)
  }, [branchQuery])
  // Typing filters the branches already loaded at once; GitHub's name search
  // runs behind it and adds the ones past the first page.
  const branchSheetOpen = sheet === "branch" || sheet === "base"
  const listedBranches = useQuery({
    ...branchesQueryOptions(workspaceSlug, channel.id, code.repo, ""),
    enabled: branchSheetOpen && Boolean(code.repo),
  })
  const branchSearch = debouncedBranchQuery.trim()
  const searchedBranches = useQuery({
    ...branchesQueryOptions(workspaceSlug, channel.id, code.repo, branchSearch),
    enabled: branchSheetOpen && Boolean(code.repo) && branchSearch !== "",
    placeholderData: (previous) => previous,
  })
  const branchOptions = [
    ...new Set([
      ...(listedBranches.data?.branches ?? []),
      ...(searchedBranches.data?.branches ?? []),
      ...(code.branch ? [code.branch] : []),
    ]),
  ].map((branch) => ({
    value: branch,
    label: branch,
    badge: branch === code.defaultBranch ? "default" : null,
  }))
  const searchingBranches =
    searchedBranches.isFetching ||
    branchQuery.trim() !== debouncedBranchQuery.trim()
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
      {needsClaude ? (
        <ConnectOnWebNotice workspaceSlug={workspaceSlug}>
          Claude Code runs on your own Claude subscription. Connect it on the
          web, or pick another agent.
        </ConnectOnWebNotice>
      ) : needsChatgpt ? (
        <ConnectOnWebNotice workspaceSlug={workspaceSlug}>
          Codex runs on your own ChatGPT plan. Connect it on the web, or pick
          another agent.
        </ConnectOnWebNotice>
      ) : null}
      {aboutMessageId ? (
        <View className="min-h-11 flex-row items-center gap-two rounded-lor-md border border-border px-three">
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
      {/* Where the session lives and works: its channel, then a code
          session's repo and branch. Asking about a message fixes the
          channel to that message's. */}
      <View className="flex-row flex-wrap items-center gap-two">
        <TargetChip
          hint="Chooses the channel the session lives in"
          icon={HashtagIcon}
          label={channelName}
          onPress={aboutMessageId ? undefined : () => setSheet("channel")}
        />
        {mode === "code" ? (
          code.status === "ready" && code.repo ? (
            <>
              <TargetChip
                hint="Chooses the repository the session works in"
                icon={GithubIcon}
                label={code.repo}
                onPress={() => setSheet("repo")}
              />
              {code.branch ? (
                <>
                  <TargetChip
                    hint="Chooses the branch the session works on, or makes a new one"
                    icon={GitBranchIcon}
                    label={code.newBranch ?? code.branch}
                    onPress={() => setSheet("branch")}
                  />
                  {/* A new branch's base, in sight: the session's diff and
                    pull request count from it. */}
                  {code.newBranch ? (
                    <>
                      <Text className="text-[13px] text-muted">from</Text>
                      <TargetChip
                        hint="Chooses the branch the new one is made from"
                        icon={GitBranchIcon}
                        label={code.branch}
                        onPress={() => setSheet("base")}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <Spinner size="sm" />
              )}
            </>
          ) : (
            <Text className="min-w-0 shrink text-[13px] text-muted">
              {codeTargetNote(code.status)}
            </Text>
          )
        ) : null}
      </View>
      {/* What it runs with: the model (and, in a code session, its agent,
          picked in the same sheet), Claude Code's mode, then the repo's
          environment. */}
      <ScrollView
        contentContainerClassName="items-center gap-two"
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        <ModelPicker
          choice={modelChoice}
          harnesses={mode === "code" ? harnessOptions : undefined}
          onHarness={setHarness}
        />
        {claudeCode ? <ClaudeCodeModePicker /> : null}
        {/* Only for a repo that has environments; they are made on the
            web. */}
        {mode === "code" &&
        code.status === "ready" &&
        environment.environments.length > 0 ? (
          <TargetChip
            hint="Chooses the environment whose env files the session uses"
            icon={Settings02Icon}
            label={environment.selected?.name ?? "No environment"}
            onPress={() => setSheet("environment")}
          />
        ) : null}
      </ScrollView>
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
                    ? {
                        ...code.target,
                        harness,
                        ...(environment.selected
                          ? { environmentId: environment.selected.id }
                          : {}),
                      }
                    : undefined,
                  {
                    ...modelChoice.turn,
                    ...(claudeCode ? { claudeCodeMode } : {}),
                  }
                )
              } finally {
                setIsSending(false)
              }
            }}
            placeholder={
              mode === "code" ? "Ask Lor to work on the code…" : "Ask Lor…"
            }
            sendBlocked={
              (mode === "code" && !code.target) || needsClaude || needsChatgpt
            }
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
        create={{
          label: (name) =>
            isValidNewBranchName(name) ? `Create ${name}` : null,
          onCreate: (name) => {
            code.createBranch(name)
            setSheet(null)
          },
        }}
        emptyText={
          searchingBranches ? "Searching GitHub…" : "No branches found"
        }
        isOpen={sheet === "branch"}
        loading={searchingBranches && branchQuery.trim() !== ""}
        onOpenChange={(open) => setSheet(open ? "branch" : null)}
        onPick={(branch) => {
          code.pickBranch(branch)
          setSheet(null)
        }}
        options={branchOptions}
        search={{ placeholder: "Find a branch", onQueryChange: setBranchQuery }}
        selected={code.newBranch ? null : code.branch}
        title="Branch"
      />
      <PickerSheet
        emptyText={
          searchingBranches ? "Searching GitHub…" : "No branches found"
        }
        isOpen={sheet === "base"}
        loading={searchingBranches && branchQuery.trim() !== ""}
        onOpenChange={(open) => setSheet(open ? "base" : null)}
        onPick={(branch) => {
          code.pickBase(branch)
          setSheet(null)
        }}
        options={branchOptions}
        search={{ placeholder: "Find a branch", onQueryChange: setBranchQuery }}
        selected={code.branch}
        title="New branch from"
      />
      <PickerSheet
        isOpen={sheet === "environment"}
        onOpenChange={(open) => setSheet(open ? "environment" : null)}
        onPick={(value) => {
          environment.select(value === NO_ENVIRONMENT ? null : value)
          setSheet(null)
        }}
        options={[
          {
            value: NO_ENVIRONMENT,
            label: "None",
            detail: "The session starts without env files.",
          },
          ...environment.environments.map((env) => ({
            value: env.id,
            label: env.name,
            detail: env.sandboxMemoryMb
              ? `${env.sandboxMemoryMb / 1024} GB sandbox`
              : undefined,
          })),
        ]}
        selected={environment.selected?.id ?? NO_ENVIRONMENT}
        title="Environment"
      />
    </>
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
