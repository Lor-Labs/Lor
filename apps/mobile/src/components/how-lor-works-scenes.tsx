import { type ReactNode, useEffect, useState } from "react"
import { Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated"
import { SessionStateIndicator } from "@/components/channel-sessions"
import {
  DestinationBar,
  type PingedPerson,
} from "@/components/composer-destination"
import { TypewriterText } from "@/components/typewriter-text"
import { Avatar } from "@/components/ui/avatar"
import { LorMark } from "@/components/voice/lor-window"

// Small animated mockups of the phone app for the How Lor works sheet. Each
// scene plays once when its step opens and holds its last frame. Mirrors
// web's how-lor-works-scenes.tsx, drawn as a phone instead of a desktop.

export type ScenePerson = { name: string; image: string | null }
export type SceneProps = { you: ScenePerson }

const MAYA: ScenePerson = { name: "Maya Okafor", image: null }
const TOMAS: ScenePerson = { name: "Tomás Reyes", image: null }
const TOMAS_FACE: PingedPerson = {
  id: "tomas",
  name: TOMAS.name,
  image: null,
  avatarColor: null,
}
const SESSION_TITLE = "Last night's deploy failure"
const QUESTION = " why did last night's deploy fail?"
// Names Maya's message from the chat, so the answer shows Lor read it.
const LOR_ANSWER =
  "A migration timed out on the invoices table. Maya's billing fix adds the missing index."
const PEOPLE_REPLY = "Looks good to me, let's ship it."

const appear = FadeInDown.duration(250)
const paneIn = FadeIn.duration(300)
const paneOut = FadeOut.duration(200)

// Phase n begins at times[n - 1] ms. Reduced motion shows the last frame.
function usePhase(times: readonly number[]) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState(reduce ? times.length : 0)
  useEffect(() => {
    if (reduce) return
    const timers = times.map((ms, index) =>
      setTimeout(() => setPhase(index + 1), ms)
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [times, reduce])
  return phase
}

// The top of a phone rising from the bottom edge.
function MiniPhone({ children }: { children: ReactNode }) {
  return (
    <View className="absolute inset-x-eight top-six -bottom-px overflow-hidden rounded-t-[28px] border border-b-0 border-border bg-background">
      {children}
    </View>
  )
}

function MiniHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-two border-b border-separator px-three pb-two pt-four">
      <Text
        className="min-w-0 flex-1 text-[13px] font-semibold text-foreground"
        numberOfLines={1}
      >
        {title}
      </Text>
      {right}
    </View>
  )
}

function PersonAvatar({ person }: { person: ScenePerson }) {
  return (
    <Avatar
      className="size-6"
      image={person.image}
      name={person.name}
      size="xs"
    />
  )
}

// Chat shows names; a session reads as a document, avatar only.
function MiniMessage({
  person,
  named = true,
  muted = false,
  children,
}: {
  person: ScenePerson
  named?: boolean
  muted?: boolean
  children: ReactNode
}) {
  return (
    <Animated.View className="flex-row gap-two" entering={appear}>
      <PersonAvatar person={person} />
      <View className="min-w-0 flex-1">
        {named ? (
          <Text className="text-[11px] font-semibold text-foreground">
            {person.name}
          </Text>
        ) : null}
        <Text
          className={`text-[12px] leading-4 ${muted ? "text-muted" : "text-foreground"}`}
        >
          {children}
        </Text>
      </View>
    </Animated.View>
  )
}

function MiniComposer({
  toLor = false,
  bar,
  children,
}: {
  toLor?: boolean
  bar?: ReactNode
  children: ReactNode
}) {
  return (
    <View
      className={`mx-three mb-three rounded-lor-sm border px-three py-two ${
        toLor ? "border-accent" : "border-border"
      }`}
    >
      <Text className="min-h-4 text-[12px] text-foreground">{children}</Text>
      {bar ? <View className="mt-one">{bar}</View> : null}
    </View>
  )
}

function LorChip() {
  return <Text className="font-medium text-accent">@Lor</Text>
}

const CHAT_TIMES = [250, 1000, 1750] as const

export function ChatScene({ you }: SceneProps) {
  const phase = usePhase(CHAT_TIMES)
  return (
    <MiniPhone>
      <MiniHeader title="# engineering" />
      <View className="flex-1 justify-end gap-three px-three pb-three">
        {phase >= 1 ? (
          <MiniMessage person={MAYA}>
            Deploy is green. Shipping the billing fix after lunch.
          </MiniMessage>
        ) : null}
        {phase >= 2 ? (
          <MiniMessage person={TOMAS}>
            Nice, I'll keep an eye on error rates.
          </MiniMessage>
        ) : null}
        {phase >= 3 ? (
          <MiniMessage person={you}>Lunch at 1? I'll book a table.</MiniMessage>
        ) : null}
      </View>
      <MiniComposer>
        <Text className="text-muted">Message #engineering</Text>
      </MiniComposer>
    </MiniPhone>
  )
}

// @Lor appears and the question types out with "New session in
// #engineering" under it; the send opens the session: your question with the
// chat it read, Lor working, then its answer.
const START_TIMES = [500, 800, 2300, 3100, 4300] as const

export function SessionStartScene({ you }: SceneProps) {
  const phase = usePhase(START_TIMES)
  const inSession = phase >= 3
  const answered = phase >= 5

  const channelPane = (
    <>
      <MiniHeader title="# engineering" />
      <View className="flex-1 justify-end gap-three px-three pb-three">
        <MiniMessage person={MAYA}>
          Deploy is green. Shipping the billing fix after lunch.
        </MiniMessage>
        <MiniMessage person={TOMAS}>
          Nice, I'll keep an eye on error rates.
        </MiniMessage>
      </View>
      <MiniComposer
        bar={
          phase >= 1 ? (
            <DestinationBar
              channelName="engineering"
              destination="channel"
              pinged={[]}
              toLor
            />
          ) : null
        }
        toLor={phase >= 1}
      >
        {phase >= 1 ? (
          <>
            <LorChip />
            <TypewriterText animate text={phase >= 2 ? QUESTION : ""} />
          </>
        ) : (
          <Text className="text-muted">Message #engineering</Text>
        )}
      </MiniComposer>
    </>
  )

  const sessionPane = (
    <>
      <MiniHeader
        title={phase >= 4 ? SESSION_TITLE : "New session"}
        right={<PersonAvatar person={you} />}
      />
      <View className="flex-1 gap-three px-three pt-three">
        <MiniMessage named={false} person={you}>
          <LorChip />
          {QUESTION}
        </MiniMessage>
        <View className="ml-eight self-start rounded-lor-sm border border-border px-two py-px">
          <Text className="text-[11px] text-muted">
            # engineering · 2 messages
          </Text>
        </View>
        <Animated.View className="flex-row gap-two" entering={appear}>
          <View className="w-6 items-center pt-px">
            <LorMark size={18} />
          </View>
          <View className="min-w-0 flex-1 gap-one">
            <View className="flex-row items-center gap-one">
              {answered ? null : <SessionStateIndicator state="running" />}
              <Text className="text-[11px] text-muted">
                {answered ? "Worked" : "Reading #engineering…"}
              </Text>
            </View>
            {/* Mounted empty first, so the answer types out when it lands. */}
            <Text className="text-[12px] leading-4 text-foreground">
              <TypewriterText animate text={answered ? LOR_ANSWER : ""} />
            </Text>
          </View>
        </Animated.View>
      </View>
    </>
  )

  return (
    <MiniPhone>
      <Animated.View
        className="absolute inset-0"
        entering={paneIn}
        exiting={paneOut}
        key={inSession ? "session" : "channel"}
      >
        {inSession ? sessionPane : channelPane}
      </Animated.View>
    </MiniPhone>
  )
}

// A teammate replies to Lor, then you switch "To Lor" to the people and talk
// it over: that turn stays muted and Lor does not answer it.
const SHARED_TIMES = [600, 1500, 2900, 3900] as const

export function SharedSessionScene({ you }: SceneProps) {
  const phase = usePhase(SHARED_TIMES)
  const drafting = phase >= 2 && phase < 4
  return (
    <MiniPhone>
      <MiniHeader
        right={
          <View className="flex-row">
            <PersonAvatar person={you} />
            {phase >= 1 ? (
              <Animated.View className="-ml-one" entering={appear}>
                <PersonAvatar person={TOMAS} />
              </Animated.View>
            ) : null}
          </View>
        }
        title={SESSION_TITLE}
      />
      <View className="flex-1 justify-end gap-three px-three pb-three">
        <View className="flex-row gap-two">
          <View className="w-6 items-center pt-px">
            <LorMark size={18} />
          </View>
          <Text className="min-w-0 flex-1 text-[12px] leading-4 text-foreground">
            {LOR_ANSWER}
          </Text>
        </View>
        {phase >= 1 ? (
          <MiniMessage named={false} person={TOMAS}>
            Can you check staging too?
          </MiniMessage>
        ) : null}
        {phase >= 4 ? (
          <MiniMessage muted named={false} person={you}>
            {PEOPLE_REPLY}
          </MiniMessage>
        ) : null}
      </View>
      <MiniComposer
        bar={
          drafting ? (
            <DestinationBar
              channelName="engineering"
              destination="session"
              pinged={[]}
              subscribers={[TOMAS_FACE]}
              toLor={phase < 3}
            />
          ) : null
        }
      >
        {/* Mounted empty first, so the reply types out when it arrives. */}
        {phase < 4 ? (
          <TypewriterText animate text={drafting ? PEOPLE_REPLY : ""} />
        ) : null}
        {drafting ? null : <Text className="text-muted">Reply…</Text>}
      </MiniComposer>
    </MiniPhone>
  )
}
