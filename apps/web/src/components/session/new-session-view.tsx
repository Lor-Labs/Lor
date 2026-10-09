import {
  ArrowDown01Icon,
  Cancel01Icon,
  HashtagIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type CSSProperties, useState } from "react"
import { MessageInput } from "@/components/chat/composer/message-input"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useSocket } from "@/context/socket-context"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMentionCandidates } from "@/hooks/use-mention-candidates"
import { useMessageSending } from "@/hooks/use-message-sending"
import { readLastChannelId } from "@/lib/last-location"
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
}: {
  workspaceSlug: string
  channelId?: string
}) {
  const { data: channels, isPending } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null)
  const options: ChannelOption[] = channels ? openTextChannels(channels) : []
  const preferred = [
    pickedChannelId,
    requestedChannelId,
    readLastChannelId(workspaceSlug),
  ].find((id) => options.some((option) => option.id === id))
  const channel =
    options.find((option) => option.id === preferred) ?? options[0]

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
}: {
  workspaceSlug: string
  channel: ChannelOption
  options: ChannelOption[]
  onPickChannel: (channelId: string) => void
}) {
  const navigate = useNavigate()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: authSession } = authClient.useSession()
  const fileUpload = useFileUpload(channel.id)
  const mentionCandidates = useMentionCandidates(workspaceSlug, channel.id)
  const channelName = channel.name ?? "channel"
  const [composerDraft, setComposerDraft] = useState<{
    id: string
    text: string
  }>()

  const { handleSend } = useMessageSending({
    socket,
    queryClient,
    channelId: channel.id,
    currentUser: authSession?.user,
    onSendFailed: () => toast.error("Couldn't start the session"),
    onSessionStarted: (started) =>
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId: started.id },
      }),
  })

  return (
    <>
      <MessageInput
        composerDraft={composerDraft}
        onComposerDraftConsumed={() => setComposerDraft(undefined)}
        context={{ type: "channel", name: channelName }}
        channelId={channel.id}
        destination="new"
        channelPicker={
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 font-medium text-agent transition-colors hover:bg-agent/10 data-popup-open:bg-agent/10">
              <HugeiconsIcon
                icon={HashtagIcon}
                className="size-3.5"
                strokeWidth={2}
              />
              {channelName}
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
        }
        placeholder="Ask Lor…"
        onSend={(content, options) =>
          handleSend(content, { mentions: [], ...options, startSession: true })
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
      <SessionExamples
        examples={sessionExamples(channelName)}
        onPick={(text) => setComposerDraft({ id: crypto.randomUUID(), text })}
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
