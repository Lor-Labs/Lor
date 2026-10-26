import {
  ArrowDown01Icon,
  Cancel01Icon,
  HashtagIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  type InfiniteData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type CSSProperties, type ReactNode, useState } from "react"
import { MessageInput } from "@/components/chat/composer/message-input"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import {
  ClaudeCodeModePicker,
  useClaudeCodeMode,
} from "@/components/session/claude-code-mode-picker"
import {
  CodeTargetPicker,
  SessionModeSwitch,
  useCodeTarget,
  useSessionMode,
} from "@/components/session/code-target-picker"
import {
  HarnessPicker,
  type SessionHarness,
  useSessionHarness,
} from "@/components/session/harness-picker"
import { SessionStartedNote } from "@/components/session/session-started-note"
import { ClaudeConnectDialog } from "@/components/settings/claude-connect-dialog"
import { useSocket } from "@/context/socket-context"
import { agentSessionQueryOptions } from "@/hooks/use-agent-session"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMentionCandidates } from "@/hooks/use-mention-candidates"
import { useMessageSending } from "@/hooks/use-message-sending"
import { usePersonalAccounts } from "@/hooks/use-personal-accounts"
import { useSessionStart } from "@/hooks/use-session-start"
import type { Message } from "@/lib/api-types"
import { readLastChannelId } from "@/lib/last-location"
import { toSearchPreviewText } from "@/lib/search-preview"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

type ChannelOption = { id: string; name: string | null }

// A large faint Lor mark behind the prompt, in the theme's foreground color.
const LOR_MARK_MASK: CSSProperties = {
  maskImage: "url(/lor-mark.svg)",
  WebkitMaskImage: "url(/lor-mark.svg)",
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
}

const EXAMPLES_DISMISSED_KEY = "lor:new-session-examples-dismissed"

function sessionExamples(channelName: string) {
  return [
    `Summarize what #${channelName} decided this week`,
    "Turn our latest discussion into a list of next steps",
    "What can you help our team with?",
  ]
}

// An empty session, laid out like an agent home screen: a centered prompt
// with the channel it will live in, preselected from where the person was
// and changeable before sending.
export function NewSessionView({
  workspaceSlug,
  channelId: requestedChannelId,
  aboutMessageId,
  continueFromSessionId,
  startHarness,
  draft,
}: {
  workspaceSlug: string
  channelId?: string
  aboutMessageId?: string
  continueFromSessionId?: string
  startHarness?: SessionHarness
  draft?: string
}) {
  const { data: channels, isPending } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null)
  const options: ChannelOption[] = channels ? openTextChannels(channels) : []
  // A session's context must come from its own channel, so asking about a
  // message or continuing a session fixes the channel to theirs.
  const channelFixed = Boolean(aboutMessageId || continueFromSessionId)
  const preferred = (
    channelFixed
      ? [requestedChannelId]
      : [pickedChannelId, requestedChannelId, readLastChannelId(workspaceSlug)]
  ).find((id) => options.some((option) => option.id === id))
  const channel = channelFixed
    ? options.find((option) => option.id === preferred)
    : (options.find((option) => option.id === preferred) ?? options[0])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <HeaderNavControls className="-ml-2" withDivider />
        <span className="font-semibold">New session</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden pb-24">
        <div className="relative w-full max-w-3xl">
          {/* Above the prompt, not behind it: the composer is translucent in
              dark mode, so an overlapping mark shows through. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[calc(100%+1rem)] left-1/2 h-60 w-[25rem] -translate-x-1/2 bg-foreground/[0.035]"
            style={LOR_MARK_MASK}
          />
          <div className="relative">
            {channel ? (
              <NewSessionComposer
                workspaceSlug={workspaceSlug}
                channel={channel}
                options={options}
                onPickChannel={setPickedChannelId}
                aboutMessageId={aboutMessageId}
                continueFromSessionId={continueFromSessionId}
                startHarness={startHarness}
                draft={draft}
              />
            ) : (
              <p className="px-4 text-center text-sm text-muted-foreground">
                {isPending
                  ? "Loading…"
                  : "Create a channel to start a session."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewSessionComposer({
  workspaceSlug,
  channel,
  options,
  onPickChannel,
  aboutMessageId,
  continueFromSessionId,
  startHarness,
  draft,
}: {
  workspaceSlug: string
  channel: ChannelOption
  options: ChannelOption[]
  onPickChannel: (channelId: string) => void
  aboutMessageId?: string
  continueFromSessionId?: string
  startHarness?: SessionHarness
  draft?: string
}) {
  const navigate = useNavigate()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: authSession } = authClient.useSession()
  const fileUpload = useFileUpload(channel.id)
  const mentionCandidates = useMentionCandidates(workspaceSlug, channel.id, {
    broadcasts: false,
  })
  const channelName = channel.name ?? "channel"
  const [composerDraft, setComposerDraft] = useState<
    { id: string; text: string } | undefined
  >(() => (draft ? { id: crypto.randomUUID(), text: draft } : undefined))
  // The asked-about message, from the channel feed when it is loaded.
  const aboutMessage = aboutMessageId
    ? queryClient
        .getQueryData<InfiniteData<{ data: Message[] }>>([
          "messages",
          channel.id,
        ])
        ?.pages.flatMap((page) => page.data)
        .find((message) => message.id === aboutMessageId)
    : undefined
  const channelLabel = (
    <>
      <HugeiconsIcon icon={HashtagIcon} className="size-3.5" strokeWidth={2} />
      {channelName}
    </>
  )

  const { data: source } = useQuery({
    ...agentSessionQueryOptions(continueFromSessionId ?? ""),
    enabled: Boolean(continueFromSessionId),
  })
  const sourceTitle = source?.session.title ?? "a session"
  const clearStartContext = () =>
    void navigate({
      to: "/$workspaceSlug/session/new",
      params: { workspaceSlug },
      search: { channelId: channel.id },
      replace: true,
    })

  const [mode, setMode] = useSessionMode(
    continueFromSessionId ? "code" : undefined
  )
  const code = useCodeTarget({
    workspaceSlug,
    channelId: channel.id,
    enabled: mode === "code",
  })
  // Claude Code runs on the starter's own Claude subscription, so without
  // one the start waits for a connect (code-sessions-runbook.md chunk 7).
  const [harness, setHarness] = useSessionHarness(startHarness)
  const claudeCode = mode === "code" && harness === "claude_code"
  const claudeMode = useClaudeCodeMode()
  const { data: accounts } = usePersonalAccounts()
  const needsClaude = claudeCode && accounts?.claude.account == null
  const [connectingClaude, setConnectingClaude] = useState(false)
  const sessionStart = useSessionStart({ workspaceSlug, channel })
  const { handleSend } = useMessageSending({
    socket,
    queryClient,
    channelId: channel.id,
    currentUser: authSession?.user,
    sessionStart: sessionStart.handlers,
  })

  const channelDropdown =
    aboutMessageId || continueFromSessionId ? (
      <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-1 font-medium text-agent">
        {channelLabel}
      </span>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 font-medium text-agent transition-colors hover:bg-agent/10 data-popup-open:bg-agent/10">
          {channelLabel}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3"
            strokeWidth={2}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56">
          <DropdownMenuRadioGroup
            value={channel.id}
            onValueChange={(value) => onPickChannel(String(value))}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                # {option.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <>
      <div className="mx-4 mb-2">
        <SessionModeSwitch mode={mode} onChange={setMode} />
      </div>
      {aboutMessageId && (
        <StartContextChip
          label="About"
          removeLabel="Remove the attached message"
          onRemove={clearStartContext}
        >
          {aboutMessage ? (
            <span className="min-w-0 truncate">
              <span className="font-medium">
                {aboutMessage.overrideName ?? aboutMessage.author.name}
              </span>{" "}
              <span className="text-muted-foreground">
                {toSearchPreviewText(
                  aboutMessage.content,
                  aboutMessage.mentions
                )}
              </span>
            </span>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">
              a message in #{channelName}
            </span>
          )}
        </StartContextChip>
      )}
      {continueFromSessionId && (
        <StartContextChip
          label="Continuing"
          removeLabel="Start without the earlier session"
          onRemove={clearStartContext}
        >
          <span className="min-w-0 truncate font-medium">{sourceTitle}</span>
        </StartContextChip>
      )}
      {needsClaude && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-foreground/[0.02] px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-muted-foreground">
            Claude Code runs on your own Claude subscription.
          </span>
          <Button size="xs" onClick={() => setConnectingClaude(true)}>
            Connect
          </Button>
        </div>
      )}
      <ClaudeConnectDialog
        open={connectingClaude}
        onOpenChange={setConnectingClaude}
      />
      <MessageInput
        composerDraft={composerDraft}
        onComposerDraftConsumed={() => setComposerDraft(undefined)}
        context={{ type: "channel", name: channelName }}
        channelId={channel.id}
        destination="new"
        notice={
          <SessionStartedNote
            session={sessionStart.started}
            workspaceSlug={workspaceSlug}
          />
        }
        channelPicker={
          mode === "code" ? (
            <>
              {channelDropdown}
              <CodeTargetPicker
                workspaceSlug={workspaceSlug}
                channelId={channel.id}
                code={code}
              />
              <HarnessPicker value={harness} onChange={setHarness} />
            </>
          ) : (
            channelDropdown
          )
        }
        placeholder={
          claudeCode
            ? "Ask Claude Code to work on the code…"
            : mode === "code"
              ? "Ask Lor to work on the code…"
              : "Ask Lor…"
        }
        sendBlocked={(mode === "code" && !code.target) || needsClaude}
        tools={
          claudeCode ? (
            <ClaudeCodeModePicker
              value={claudeMode.mode}
              onChange={claudeMode.setMode}
            />
          ) : undefined
        }
        onShiftTab={claudeCode ? claudeMode.cycle : undefined}
        onSend={(content, options) =>
          handleSend(content, {
            mentions: [],
            ...options,
            startSession: true,
            contextMessageId: aboutMessageId,
            ...(mode === "code" && code.target
              ? { code: code.target, harness }
              : {}),
            ...(claudeCode ? { claudeCodeMode: claudeMode.mode } : {}),
            ...(continueFromSessionId
              ? {
                  continueFrom: {
                    id: continueFromSessionId,
                    title: sourceTitle,
                  },
                }
              : {}),
          })
        }
        currentUserId={authSession?.user.id}
        mentionCandidates={mentionCandidates}
        pendingAttachments={fileUpload.attachments}
        addFiles={fileUpload.addFiles}
        removeAttachment={fileUpload.removeAttachment}
        clearAttachments={fileUpload.clearAttachments}
        getUploadedAttachments={fileUpload.getUploadedAttachments}
        isUploading={fileUpload.isUploading}
      />
      {!(aboutMessageId || continueFromSessionId) && mode === "chat" && (
        <SessionExamples
          examples={sessionExamples(channelName)}
          onPick={(text) => setComposerDraft({ id: crypto.randomUUID(), text })}
        />
      )}
    </>
  )
}

// What the session starts with, above the prompt: an asked-about message or
// the session being continued.
function StartContextChip({
  label,
  removeLabel,
  onRemove,
  children,
}: {
  label: string
  removeLabel: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-foreground/[0.02] px-3 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          className="size-3.5"
          strokeWidth={2}
        />
      </button>
    </div>
  )
}

function SessionExamples({
  examples,
  onPick,
}: {
  examples: string[]
  onPick: (text: string) => void
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(EXAMPLES_DISMISSED_KEY) === "true"
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  if (dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(EXAMPLES_DISMISSED_KEY, "true")
    } catch {}
    setDismissed(true)
  }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between pl-3 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="cursor-pointer py-1 transition-colors hover:text-foreground"
        >
          Get started with some examples
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide examples"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </button>
      </div>
      {open && (
        <div className="mt-1 space-y-0.5">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                onPick(example)
                setOpen(false)
              }}
              className="flex w-full cursor-pointer items-center rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
