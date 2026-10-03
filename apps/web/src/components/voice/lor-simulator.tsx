import { TestTube01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useLocalParticipant } from "@livekit/components-react"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { useVoiceCall } from "@/context/voice-call-context"
import {
  applyVoiceRequestUpdate,
  voiceRequestsQueryKey,
} from "@/hooks/use-voice-requests"

// Dev only: plays scripted requests to Lor through Lor's window, so its states
// can be tuned without speaking. It writes what the server would send (request
// states and live captions) and skips the transcriber and Jev. Timings follow
// the pipeline as measured: live words about every 200ms, Jev about 350ms.
const WORD_MS = 200
const JEV_MS = 350
const SILENCE_TIMEOUT_MS = 4_000
const SIMULATED_ID_PREFIX = "dev-sim-"

export type SimulatedCaption = {
  id: string
  participantId: string
  text: string
  final: boolean
  updatedAt: number
}

let captions: SimulatedCaption[] = []
const listeners = new Set<() => void>()

function setCaptions(next: SimulatedCaption[]) {
  captions = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getCaptions = () => captions

// Always empty outside dev: nothing writes to the store.
export function useSimulatedCaptions() {
  return useSyncExternalStore(subscribe, getCaptions, getCaptions)
}

export function isSimulatedRequest(request: Pick<VoiceRequestState, "id">) {
  return request.id.startsWith(SIMULATED_ID_PREFIX)
}

const simulatedId = () => `${SIMULATED_ID_PREFIX}${crypto.randomUUID()}`

class Stopped extends Error {}

// One scripted run. Starting another run, or Cancel in Lor's window, stops it.
class Simulation {
  stopped = false

  constructor(
    readonly queryClient: QueryClient,
    readonly sessionId: string,
    readonly participantId: string
  ) {}

  wait(ms: number) {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => (this.stopped ? reject(new Stopped()) : resolve()), ms)
    })
  }

  // Runs alongside the speech, like a Jev check while the speaker goes on.
  after(ms: number, step: () => void) {
    const pending = this.wait(ms).then(step)
    // A run stopped mid-line never awaits this; don't report it unhandled.
    pending.catch(() => undefined)
    return pending
  }

  // A caption line spoken word by word, then made final.
  line() {
    const id = simulatedId()
    let text = ""
    const publish = (final: boolean) =>
      setCaptions([
        ...captions.filter((caption) => caption.id !== id),
        {
          id,
          participantId: this.participantId,
          text,
          final,
          updatedAt: Date.now(),
        },
      ])
    return {
      say: async (words: string) => {
        for (const word of words.split(" ")) {
          text = text ? `${text} ${word}` : word
          publish(false)
          await this.wait(WORD_MS)
        }
      },
      end: () => publish(true),
    }
  }

  request() {
    const id = simulatedId()
    let createdAt: string | null = null
    return (status: VoiceRequestState["status"], heardText: string) => {
      const list =
        this.queryClient.getQueryData<VoiceRequestState[]>(
          voiceRequestsQueryKey(this.sessionId)
        ) ?? []
      if (list.find((entry) => entry.id === id)?.status === "cancelled") {
        throw new Stopped()
      }
      const now = new Date().toISOString()
      createdAt ??= now
      applyVoiceRequestUpdate(this.queryClient, {
        id,
        sessionId: this.sessionId,
        participantId: this.participantId,
        userId: this.participantId,
        heardText,
        status,
        result: null,
        createdAt,
        updatedAt: now,
      })
    }
  }
}

type Scenario = { label: string; run: (sim: Simulation) => Promise<void> }

const askInOneGo = async (sim: Simulation) => {
  const line = sim.line()
  const set = sim.request()
  await line.say("Lor,")
  const opened = sim.after(JEV_MS, () => set("listening", "Lor,"))
  await line.say("what did we decide about pricing last week?")
  await opened
  line.end()
  await sim.wait(JEV_MS)
  set("queued", "Lor, what did we decide about pricing last week?")
}

const SCENARIOS: Scenario[] = [
  {
    label: "Calls Lor, never finishes",
    run: async (sim) => {
      const line = sim.line()
      const set = sim.request()
      await line.say("Hey Lor,")
      const opened = sim.after(JEV_MS, () => set("listening", "Hey Lor,"))
      await line.say("um…")
      await opened
      line.end()
      await sim.wait(SILENCE_TIMEOUT_MS)
      set("rejected", "Hey Lor, um…")
    },
  },
  {
    label: "Calls Lor, pauses, then asks",
    run: async (sim) => {
      const first = sim.line()
      const set = sim.request()
      await first.say("Hey Lor,")
      await sim.wait(JEV_MS)
      set("listening", "Hey Lor,")
      first.end()
      await sim.wait(1_500)
      const second = sim.line()
      await second.say("pull up the tickets I created yesterday")
      second.end()
      await sim.wait(JEV_MS)
      set("queued", "Hey Lor, pull up the tickets I created yesterday")
    },
  },
  { label: "Asks in one go", run: askInOneGo },
  {
    label: "New request while Lor works",
    run: async (sim) => {
      await askInOneGo(sim)
      await sim.wait(2_500)
      const line = sim.line()
      const set = sim.request()
      await line.say("Lor,")
      const opened = sim.after(JEV_MS, () => set("listening", "Lor,"))
      await line.say("actually stop that and open the auth PR")
      await opened
      line.end()
      await sim.wait(JEV_MS)
      set("queued", "Lor, actually stop that and open the auth PR")
    },
  },
  {
    label: "Mentions Lor in passing",
    run: async (sim) => {
      const line = sim.line()
      await line.say("We should ask Lor about that later")
      line.end()
      await sim.wait(JEV_MS)
      toast.info("Jev: not addressed, so Lor's window stays closed")
    },
  },
]

let current: Simulation | null = null

function play(scenario: Scenario, simulation: Simulation) {
  if (current) current.stopped = true
  current = simulation
  setCaptions([])
  // Drop the last run's requests, which never finish on their own.
  simulation.queryClient.setQueryData<VoiceRequestState[]>(
    voiceRequestsQueryKey(simulation.sessionId),
    (list) => list?.filter((entry) => !isSimulatedRequest(entry))
  )
  void scenario.run(simulation).catch((err: unknown) => {
    if (!(err instanceof Stopped)) toast.error("Lor simulation failed")
  })
}

export function LorSimulatorMenu() {
  const { call } = useVoiceCall()
  const { localParticipant } = useLocalParticipant()
  const queryClient = useQueryClient()
  if (!call) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon"
            variant="outline"
            aria-label="Simulate a request to Lor"
          />
        }
      >
        <HugeiconsIcon icon={TestTube01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Simulate Lor (dev)</DropdownMenuLabel>
          {SCENARIOS.map((scenario) => (
            <DropdownMenuItem
              key={scenario.label}
              onClick={() =>
                play(
                  scenario,
                  new Simulation(
                    queryClient,
                    call.sessionId,
                    localParticipant.identity
                  )
                )
              }
            >
              {scenario.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
