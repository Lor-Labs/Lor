import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useParticipants, useTranscriptions } from "@livekit/components-react"
import { authClient } from "@repo/auth/client"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useState } from "react"
import { toolIcon } from "@/components/chat/lor-tool-trail"
import { captionLine } from "@/components/voice/call-captions"
import { LorBlocks, LorFailedNotice } from "@/components/voice/lor-blocks"
import {
  resolveSimulatedApproval,
  useSimulatedCaptions,
} from "@/components/voice/lor-simulator"
import {
  REACTION_MS,
  useLorReactions,
  useLorTools,
} from "@/components/voice/lor-stage-store"
import { useVoiceEntityCards } from "@/hooks/use-voice-entity-cards"
import {
  isActiveVoiceRequest,
  stageVoiceRequest,
  voiceRequestsQueryKey,
} from "@/hooks/use-voice-requests"
import { apiClient } from "@/lib/api-client"
import { isSimulatedRequest } from "@/lib/lor-simulation"

// Reaches back to the caption line that said "Lor": the request is created
// once Jev answers, a moment after the name was heard.
const LIVE_LOOKBACK_MS = 2_000

// The speaker's words as they say them, from the call's captions.
function LiveWords({ request }: { request: VoiceRequestState }) {
  const transcriptions = useTranscriptions()
  const simulated = useSimulatedCaptions()
  const since = Date.parse(request.createdAt) - LIVE_LOOKBACK_MS
  const lines = [...transcriptions.map(captionLine), ...simulated].filter(
    (line) =>
      line.participantId === request.participantId &&
      line.updatedAt >= since &&
      line.text.trim()
  )
  if (lines.length === 0) return <>{request.heardText}</>
  return lines.map((line) => (
    <span
      key={line.id}
      className={cn(
        "transition-colors",
        line.final ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {line.text}{" "}
    </span>
  ))
}

// Reactions Lor chose, floating up from its mark.
function Reactions({ requestId }: { requestId: string }) {
  const reactions = useLorReactions(requestId)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1/2 flex justify-center">
      <AnimatePresence>
        {reactions.map((reaction) => (
          <motion.span
            key={reaction.id}
            className="absolute text-2xl"
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -56, scale: 1 }}
            transition={{ duration: REACTION_MS / 1000, ease: EASE_OUT }}
          >
            {reaction.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}

type MarkState = "listening" | "working" | "idle"

// Lor's mark: a pulsing halo while it listens, a turning arc while it works.
function LorMark({
  requestId,
  state,
  size,
}: {
  requestId: string
  state: MarkState
  size: "sm" | "lg"
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        size === "lg" ? "size-14" : "size-8"
      )}
    >
      {state === "listening" && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/25"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: EASE_OUT }}
        />
      )}
      {state === "working" && (
        <motion.span
          aria-hidden
          className="absolute -inset-1 rounded-full border-2 border-primary/15 border-t-primary"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      )}
      <img src="/lor-mark.svg" alt="" className="relative size-full" />
      <Reactions requestId={requestId} />
    </div>
  )
}

function toolLabel(toolName: string) {
  const words = toolName.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The tools Lor has used on this request, one mark per kind; the newest
// pulses while Lor works.
function ToolRow({
  requestId,
  working,
}: {
  requestId: string
  working: boolean
}) {
  const toolNames = useLorTools(requestId)
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  const marks = toolNames
    .map((toolName) => ({ toolName, Icon: toolIcon(toolName) }))
    .filter(
      (mark, index, all) =>
        all.findIndex((entry) => entry.Icon === mark.Icon) === index
    )
  if (marks.length === 0) return null
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {marks.map(({ toolName, Icon }, index) => (
        <TooltipTrigger
          key={toolName}
          handle={tooltipHandle}
          payload={toolLabel(toolName)}
          delay={300}
          render={
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={
                working && index === marks.length - 1
                  ? { opacity: [1, 0.4, 1], scale: 1 }
                  : { opacity: 1, scale: 1 }
              }
              transition={
                working && index === marks.length - 1
                  ? { duration: 1.2, repeat: Infinity }
                  : { duration: 0.2, ease: EASE_OUT }
              }
              className="relative flex pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-2"
            />
          }
        >
          <Icon className="size-4" />
        </TooltipTrigger>
      ))}
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => <TooltipContent side="top">{payload}</TooltipContent>}
      </Tooltip>
    </div>
  )
}

type PendingApproval = NonNullable<VoiceRequestState["approval"]>

const orList = new Intl.ListFormat(undefined, { type: "disjunction" })

// A paused request's approval, over a blurred window. Only people in the call
// who can resolve it get the buttons; the server checks again.
function ApprovalOverlay({
  request,
  approval,
}: {
  request: VoiceRequestState
  approval: PendingApproval
}) {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const [sending, setSending] = useState(false)
  const canResolve = approval.approvers.some(
    (approver) => approver.userId === session?.user.id
  )
  const Icon = toolIcon(approval.toolName)

  const resolve = async (resolution: "approve" | "reject") => {
    if (isSimulatedRequest(request)) {
      resolveSimulatedApproval(queryClient, request, resolution === "approve")
      return
    }
    setSending(true)
    const res = await apiClient.v1.approvals[":approvalId"][resolution]
      .$post({ param: { approvalId: approval.approvalId } })
      .catch(() => null)
    // On success the request resumes, and its update removes this overlay.
    if (!res?.ok) {
      toast.error("Couldn't record that. Try again.")
      setSending(false)
    }
  }

  const names = approval.approvers.map((approver) => approver.name)
  const waiting =
    names.length > 0
      ? `Waiting for ${orList.format(names)} to approve`
      : "Waiting for someone who can approve"

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="absolute inset-0 z-[5] flex items-center justify-center bg-background/40 p-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, y: 6 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT }}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-popover p-5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <Icon className="size-4" />
            Lor needs approval
          </span>
          <p className="text-balance font-medium">{approval.label}</p>
        </div>
        {canResolve ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={sending}
              onClick={() => void resolve("approve")}
            >
              Approve
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              disabled={sending}
              onClick={() => void resolve("reject")}
            >
              Reject
            </Button>
          </div>
        ) : (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {waiting}
          </p>
        )}
      </motion.div>
    </motion.div>
  )
}

// Width of Lor's window beside a screen share.
const DOCKED_WIDTH = 400

// Where Lor's window lives in the screen-share slot: the whole slot, or a
// panel that slides in beside a screen share so it never covers it. Stays
// mounted across requests, so a new one crossfades inside it.
export function LorStage({
  docked,
  children,
}: {
  docked: boolean
  children: ReactNode
}) {
  const closed = docked
    ? { width: 0, opacity: 0 }
    : { width: "100%", opacity: 0, scale: 0.97 }
  return (
    <motion.div
      initial={closed}
      animate={{ width: docked ? DOCKED_WIDTH : "100%", opacity: 1, scale: 1 }}
      exit={closed}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="relative h-full shrink-0 overflow-hidden"
    >
      {/* Fixed width while docked, so the content doesn't reflow as the
          panel slides open. */}
      <div
        className={cn("absolute inset-y-0 right-0", docked && "pl-3")}
        style={{ width: docked ? DOCKED_WIDTH : "100%" }}
      >
        {children}
      </div>
    </motion.div>
  )
}

// Lor's window, the same for everyone in the call. Opens once Jev says Lor
// was addressed; a finished result stays until someone clears it.
export function LorWindow({
  request,
  results,
}: {
  request: VoiceRequestState
  // The call's results, oldest first, for stepping back ("2 of 3").
  results: VoiceRequestState[]
}) {
  const queryClient = useQueryClient()
  const participants = useParticipants()
  const speakerName =
    participants.find(
      (participant) => participant.identity === request.participantId
    )?.name || "someone"
  const active = isActiveVoiceRequest(request)
  const listening = request.status === "listening"
  const approval =
    request.status === "awaiting_approval" ? request.approval : null
  const markState: MarkState = listening
    ? "listening"
    : active && !approval
      ? "working"
      : "idle"
  const blocks = request.result?.blocks ?? []
  const entityCards = useVoiceEntityCards(request, true)

  // Cancels Lor's work while it's active; clears the finished result after.
  const close = async () => {
    const queryKey = voiceRequestsQueryKey(request.sessionId)
    queryClient.setQueryData<VoiceRequestState[]>(queryKey, (list) =>
      list?.map((entry) =>
        entry.id !== request.id
          ? entry
          : active
            ? {
                ...entry,
                status: "cancelled",
                finishedAt: new Date().toISOString(),
              }
            : { ...entry, dismissedAt: new Date().toISOString() }
      )
    )
    if (isSimulatedRequest(request)) return
    const action =
      apiClient.v1.voice.requests[":requestId"][active ? "cancel" : "dismiss"]
    const res = await action
      .$post({ param: { requestId: request.id } })
      .catch(() => null)
    // 409: someone else got there first, which closes the window anyway.
    if (!res || (!res.ok && res.status !== 409)) {
      toast.error(active ? "Couldn't cancel the request" : "Couldn't clear it")
      void queryClient.invalidateQueries({ queryKey })
    }
  }
  const closeLabel = active ? "Cancel request" : "Clear"

  // Stepping stages the neighbouring result, so the whole call moves with it.
  const step = results.findIndex((entry) => entry.id === request.id)
  const stepTo = (index: number) => {
    const target = results[index]
    if (target) void stageVoiceRequest(queryClient, target)
  }
  const stepper = step >= 0 && results.length > 1 && (
    <div className="flex items-center gap-0.5 text-muted-foreground text-xs tabular-nums">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Earlier result"
        disabled={step === 0}
        onClick={() => stepTo(step - 1)}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
      </Button>
      <span>
        {step + 1} of {results.length}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Later result"
        disabled={step === results.length - 1}
        onClick={() => stepTo(step + 1)}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
      </Button>
    </div>
  )

  // A picked choice becomes a new request from whoever clicked, which then
  // takes over the window.
  const [choosing, setChoosing] = useState(false)
  const choose = async (index: number) => {
    if (isSimulatedRequest(request)) {
      toast.info("Simulated: the pick would go to Lor as a new request")
      return
    }
    setChoosing(true)
    const res = await apiClient.v1.voice.requests[":requestId"].choose
      .$post({ param: { requestId: request.id }, json: { choice: index } })
      .catch(() => null)
    if (!res?.ok) {
      toast.error("Couldn't send that to Lor")
      setChoosing(false)
    }
  }

  const closeButton = (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={closeLabel}
            onClick={() => void close()}
            className="absolute top-3 right-3 z-10 text-muted-foreground opacity-0 transition-opacity group-hover/lor:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          />
        }
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{closeLabel}</p>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="group/lor absolute inset-0 flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      {closeButton}
      {blocks.length > 0 ? (
        <>
          <div className="flex shrink-0 items-center gap-3 border-border/60 border-b px-5 py-3 pr-12">
            <LorMark requestId={request.id} state={markState} size="sm" />
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {request.heardText}
            </p>
            <div className="ml-auto flex items-center gap-3">
              <ToolRow requestId={request.id} working={active && !approval} />
              {stepper}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <LorBlocks
              blocks={blocks}
              cards={{
                data: entityCards.data,
                failed: entityCards.isError,
              }}
              onChoose={
                request.status === "done" && !choosing
                  ? (index) => void choose(index)
                  : undefined
              }
            />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <LorMark requestId={request.id} state={markState} size="lg" />
          <div className="flex max-w-2xl flex-col gap-2">
            {listening && (
              <span
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                Listening to {speakerName}
              </span>
            )}
            <p className="text-balance text-xl font-medium leading-snug">
              {listening ? <LiveWords request={request} /> : request.heardText}
            </p>
            {request.status === "failed" && (
              <LorFailedNotice className="self-center" />
            )}
          </div>
          <ToolRow requestId={request.id} working={active && !approval} />
        </div>
      )}
      <AnimatePresence>
        {approval && (
          <ApprovalOverlay
            key={approval.approvalId}
            request={request}
            approval={approval}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
