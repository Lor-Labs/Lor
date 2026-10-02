import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useParticipants, useTranscriptions } from "@livekit/components-react"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { Button } from "@repo/ui/components/button"
import { TextShimmer } from "@repo/ui/components/nexus-ui/text-shimmer"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { captionLine } from "@/components/voice/call-captions"
import {
  isSimulatedRequest,
  useSimulatedCaptions,
} from "@/components/voice/lor-simulator"
import { voiceRequestsQueryKey } from "@/hooks/use-voice-requests"
import { apiClient } from "@/lib/api-client"

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

function LorMark({ listening }: { listening: boolean }) {
  return (
    <div className="relative flex size-14 items-center justify-center">
      {listening && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/25"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: EASE_OUT }}
        />
      )}
      <img src="/lor-mark.svg" alt="" className="relative size-14" />
    </div>
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
// was addressed.
export function LorWindow({ request }: { request: VoiceRequestState }) {
  const queryClient = useQueryClient()
  const participants = useParticipants()
  const speakerName =
    participants.find(
      (participant) => participant.identity === request.participantId
    )?.name || "someone"
  const listening = request.status === "listening"

  const cancel = async () => {
    const queryKey = voiceRequestsQueryKey(request.sessionId)
    queryClient.setQueryData<VoiceRequestState[]>(queryKey, (list) =>
      list?.map((entry) =>
        entry.id === request.id ? { ...entry, status: "cancelled" } : entry
      )
    )
    if (isSimulatedRequest(request)) return
    const res = await apiClient.v1.voice.requests[":requestId"].cancel
      .$post({ param: { requestId: request.id } })
      .catch(() => null)
    // 409: it finished first, which closes the window anyway.
    if (!res || (!res.ok && res.status !== 409)) {
      toast.error("Couldn't cancel the request")
      void queryClient.invalidateQueries({ queryKey })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="group/lor absolute inset-0 flex flex-col items-center justify-center gap-6 rounded-lg border border-border bg-card p-8 text-center"
    >
      <Tooltip>
        <TooltipTrigger
          delay={300}
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Cancel request"
              onClick={() => void cancel()}
              className="absolute top-3 right-3 text-muted-foreground opacity-0 transition-opacity group-hover/lor:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Cancel request</p>
        </TooltipContent>
      </Tooltip>
      <LorMark listening={listening} />
      <div className="flex max-w-2xl flex-col gap-2">
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {listening ? (
            `Listening to ${speakerName}`
          ) : (
            <TextShimmer>Working on it</TextShimmer>
          )}
        </span>
        <p className="text-balance text-xl font-medium leading-snug">
          {listening ? <LiveWords request={request} /> : request.heardText}
        </p>
      </div>
    </motion.div>
  )
}
