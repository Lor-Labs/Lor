"use client"

import {
  CallEnd01Icon,
  ClosedCaptionIcon,
  HashtagIcon,
  Mic01Icon,
  MicOff01Icon,
  PlusSignIcon,
  SentIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import {
  ChatLine,
  PersonAvatar,
  RAFAEL,
  THEO,
  ZOE,
} from "@/app/components/mock-parts"

// The call floats over channel chat in the app. Keep it in flow here so both
// the conversation and the call remain readable in the smaller illustration.
export function TeamChatPreview() {
  const [joined, setJoined] = useState(true)
  const [muted, setMuted] = useState(false)
  const [captions, setCaptions] = useState(true)

  return (
    <div className="bg-lor-bg-dark text-left">
      <div className="flex h-12 items-center gap-2 border-b border-lor-border-dark/60 px-4 text-lor-text-secondary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={17} />
        <h3 className="text-sm font-medium text-lor-text-dark">general</h3>
        <span className="ml-auto text-[10px] text-lor-text-tertiary-dark">
          Product preview
        </span>
      </div>
      <div className="px-5 pt-3 pb-5 sm:px-6">
        <div className="mb-1 flex items-center gap-3 text-[10px] text-lor-text-tertiary-dark">
          <span className="h-px flex-1 bg-lor-border-dark/50" />
          Today
          <span className="h-px flex-1 bg-lor-border-dark/50" />
        </div>
        <ChatLine avatar={ZOE} name="Zoe" time="10:42 AM">
          Homepage is ready for a final look. Anything we should change before
          Friday?
        </ChatLine>
        <ChatLine avatar={THEO} name="Theo" time="10:43 AM">
          One thing on mobile. Easier to show you — I&rsquo;m in team-room.
        </ChatLine>
        <ChatLine avatar={RAFAEL} name="Rafael" time="10:43 AM">
          Joining. I&rsquo;ve got the customer notes open too.
        </ChatLine>
        <div className="mt-5 overflow-hidden rounded-xl border border-lor-border-dark bg-lor-surface-dark shadow-lg">
          <div className="flex items-center gap-2 px-3.5 py-3 text-xs text-lor-text-secondary-dark">
            <HugeiconsIcon icon={VolumeHighIcon} size={15} />
            <span className="font-medium text-lor-text-dark">team-room</span>
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-lor-text-tertiary-dark">
              <span className="size-1.5 rounded-full bg-lor-success-dark" />
              {joined ? "3 in call" : "2 in call"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 px-3.5">
            {[
              { name: "Theo", avatar: THEO, speaking: true },
              { name: "Rafael", avatar: RAFAEL, speaking: false },
              { name: "Zoe (you)", avatar: ZOE, speaking: false },
            ].map((person) => (
              <div
                key={person.name}
                className={`relative flex aspect-video min-h-20 items-center justify-center rounded-lg bg-lor-bg-dark ${joined && person.speaking ? "ring-1 ring-inset ring-agent/70" : ""} ${!joined && person.avatar === ZOE ? "opacity-25" : ""}`}
              >
                <PersonAvatar src={person.avatar} size="size-10 sm:size-12" />
                <span className="absolute bottom-1.5 left-1.5 rounded bg-lor-bg-dark/80 px-1 text-[10px] text-lor-text-secondary-dark">
                  {person.name}
                </span>
                {person.avatar === ZOE && muted && joined ? (
                  <HugeiconsIcon
                    icon={MicOff01Icon}
                    size={12}
                    className="absolute top-2 right-2 text-lor-danger-dark"
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex min-h-14 items-center justify-center px-4 py-3 text-center text-[11px] leading-relaxed text-lor-text-secondary-dark">
            {joined && captions ? (
              <p>
                <span className="mr-1.5 text-lor-text-tertiary-dark">Theo</span>
                &ldquo;Let&rsquo;s give the headline a little more room on
                mobile.&rdquo;
              </p>
            ) : (
              <p className="text-lor-text-tertiary-dark">
                {joined
                  ? "Captions off"
                  : "Theo and Rafael are still in the call."}
              </p>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 border-t border-lor-border-dark/60 px-4 py-3">
            {joined ? (
              <>
                <button
                  type="button"
                  onClick={() => setMuted((value) => !value)}
                  aria-label={
                    muted
                      ? "Unmute microphone in preview"
                      : "Mute microphone in preview"
                  }
                  aria-pressed={muted}
                  className={`flex size-9 cursor-pointer items-center justify-center rounded-md border border-lor-border-dark transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent ${muted ? "bg-lor-danger-dark/10 text-lor-danger-dark" : "text-lor-text-secondary-dark hover:bg-foreground/5"}`}
                >
                  <HugeiconsIcon
                    icon={muted ? MicOff01Icon : Mic01Icon}
                    size={17}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setCaptions((value) => !value)}
                  aria-label="Captions in preview"
                  aria-pressed={captions}
                  className={`flex size-9 cursor-pointer items-center justify-center rounded-md border border-lor-border-dark transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent ${captions ? "bg-foreground/[0.06] text-lor-text-dark" : "text-lor-text-tertiary-dark hover:bg-foreground/5"}`}
                >
                  <HugeiconsIcon icon={ClosedCaptionIcon} size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setJoined(false)}
                  aria-label="Leave preview call"
                  className="flex size-9 cursor-pointer items-center justify-center rounded-md bg-lor-danger-dark/10 text-lor-danger-dark transition-colors hover:bg-lor-danger-dark/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
                >
                  <HugeiconsIcon icon={CallEnd01Icon} size={17} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setJoined(true)
                  setMuted(false)
                }}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
              >
                <HugeiconsIcon icon={VolumeHighIcon} size={14} />
                Join call
              </button>
            )}
          </div>
          <p className="sr-only" role="status">
            {joined
              ? `Preview call joined. Microphone ${muted ? "muted" : "on"}.`
              : "You left the preview call."}
          </p>
        </div>
        <div
          aria-hidden="true"
          className="mt-5 rounded-lg border border-lor-border-dark/70 px-3.5 py-3 text-lor-text-tertiary-dark"
        >
          <p className="text-[12px]">Message #general</p>
          <div className="mt-4 flex items-center justify-between">
            <HugeiconsIcon icon={PlusSignIcon} size={15} />
            <HugeiconsIcon icon={SentIcon} size={15} />
          </div>
        </div>
      </div>
    </div>
  )
}
