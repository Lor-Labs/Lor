import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon"
import ThumbsUpIcon from "@hugeicons/core-free-icons/ThumbsUpIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { AVATAR_COLOR_STYLES } from "@repo/utils/avatar-colors"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Image, Text, View } from "react-native"
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import { SessionStateIndicator } from "@/components/channel-sessions"
import {
  DestinationBar,
  type PingedPerson,
} from "@/components/composer-destination"
import { ConnectorIcon } from "@/components/connector-icon"
import { TypewriterText } from "@/components/typewriter-text"
import { Avatar } from "@/components/ui/avatar"
import { LorMark } from "@/components/voice/lor-window"
import rafaelAvatar from "../../assets/images/tour/rafael.png"
import zoeAvatar from "../../assets/images/tour/zoe.png"

// Small animated mockups of the phone app for the How Lor works sheet. Each
// scene plays once when its step opens and holds its last frame. Mirrors
// web's how-lor-works-scenes.tsx, drawn as a phone instead of a desktop.

export type ScenePerson = { name: string; image: string | null }
export type SceneProps = {
  you: ScenePerson
  // Once the scene has played (never under reduced motion): shows Replay.
  onDone?: () => void
}

// DiceBear Lorelei (CC0), the same files as web's public/tour.
const ZOE: ScenePerson = {
  name: "Zoe Brandt",
  image: Image.resolveAssetSource(zoeAvatar).uri,
}
const RAFAEL: ScenePerson = {
  name: "Rafael Ortiz",
  image: Image.resolveAssetSource(rafaelAvatar).uri,
}
const RAFAEL_FACE: PingedPerson = {
  id: "rafael",
  ...RAFAEL,
  avatarColor: null,
}
const SESSION_TITLE = "Last night's deploy failure"
const QUESTION = " why did last night's deploy fail?"
// Names Zoe's message from the chat, so the answer shows Lor read it.
const LOR_ANSWER =
  "A migration timed out on the invoices table. Zoe's billing fix adds the missing index."
const PEOPLE_REPLY = "Looks good to me, let's ship it."

const appear = FadeInDown.duration(250)
const paneIn = FadeIn.duration(300)
const paneOut = FadeOut.duration(200)

// Done fires after the last phase settles (typing, cursor travel).
const SCENE_SETTLE_MS = 1200

// Phase n begins at times[n - 1] ms. Reduced motion shows the last frame.
function usePhase(times: readonly number[], onDone?: () => void) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState(reduce ? times.length : 0)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })
  useEffect(() => {
    if (reduce) return
    const timers = times.map((ms, index) =>
      setTimeout(() => setPhase(index + 1), ms)
    )
    timers.push(
      setTimeout(
        () => onDoneRef.current?.(),
        (times.at(-1) ?? 0) + SCENE_SETTLE_MS
      )
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
      {/* A row, as in the real composer: the bar stretches across it. The
          pill's own padding is pulled back so "To" lines up with the text. */}
      {bar ? <View className="-ml-two mt-one flex-row">{bar}</View> : null}
    </View>
  )
}

function MentionChip({ name = "Lor" }: { name?: string }) {
  return <Text className="font-medium text-accent">@{name}</Text>
}

type CursorColors = { background: string; foreground: string }

const cursorEasing = { duration: 800, easing: Easing.out(Easing.cubic) }

// People take avatar palette colors; Lor takes the accent.
const COLOR_ROSE: CursorColors = {
  background: AVATAR_COLOR_STYLES.rose.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.rose.foregroundColor,
}
const COLOR_EMERALD: CursorColors = {
  background: AVATAR_COLOR_STYLES.emerald.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.emerald.foregroundColor,
}
const COLOR_BLUE: CursorColors = {
  background: AVATAR_COLOR_STYLES.blue.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.blue.foregroundColor,
}

// A named cursor whose tip glides to x, y (pt from the doc's top-left).
function SceneCursor({
  name,
  colors,
  x,
  y,
}: {
  name: string
  colors: CursorColors
  x: number
  y: number
}) {
  const outline = useThemeColor("background")
  const left = useSharedValue(x)
  const top = useSharedValue(y)
  useEffect(() => {
    left.value = withTiming(x, cursorEasing)
    top.value = withTiming(y, cursorEasing)
  }, [x, y, left, top])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: left.value }, { translateY: top.value }],
  }))
  return (
    <Animated.View
      accessibilityElementsHidden
      // Wide enough for the name: an absolute label only gets its parent's
      // width, and a cursor-sized box cut "Lor" to "L".
      className="absolute left-0 top-0 w-[120px]"
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={style}
    >
      <Svg height={20} viewBox="0 0 16 20" width={16}>
        <Path
          d="M1 1V15.5L4.8 11.9L7.4 18L9.9 16.9L7.4 10.9H12.6L1 1Z"
          fill={colors.background}
          stroke={outline}
          strokeLinejoin="round"
          strokeWidth={1.2}
        />
      </Svg>
      <View
        className="absolute left-3 top-4 rounded-full px-[6px] py-px"
        style={{ backgroundColor: colors.background }}
      >
        <Text
          className="text-[10px] font-medium"
          numberOfLines={1}
          style={{ color: colors.foreground }}
        >
          {name}
        </Text>
      </View>
    </Animated.View>
  )
}

const WELCOME_ASK = " draft the launch post for Thursday"
const WELCOME_DRAFT =
  "Here's a draft for #announcements: shared sessions ship Thursday, for every team."
const WELCOME_TIMES = [400, 1300, 2900, 3800, 5200, 6200, 6800, 7900] as const

// The tour's first step: a team working with Lor in one session. Zoe asks,
// Lor drafts while its cursor writes, Rafael reacts, then you approve the
// post (one cursor at a time, so each action reads on its own).
// Lor has no live cursors yet; this shows the idea. Rows have fixed heights
// so each cursor's tip (pt from the card's top-left, per phase) lands on its
// target.
export function WelcomeScene({ you, onDone }: SceneProps) {
  const phase = usePhase(WELCOME_TIMES, onDone)
  const [accent, accentForeground, muted] = useThemeColor([
    "accent",
    "accent-foreground",
    "muted",
  ])
  const asking = phase >= 1 && phase < 3
  const approved = phase >= 8
  const zoe = phase >= 3 ? [298, 60] : phase >= 1 ? [24, 186] : [-80, 190]
  const lor = approved
    ? [300, 120]
    : phase >= 4
      ? [262, 96]
      : phase >= 3
        ? [34, 78]
        : [330, 10]
  const rafael = phase >= 7 ? [-20, 110] : phase >= 5 ? [48, 122] : [-80, 60]
  const yours = phase >= 7 ? [251, 150] : [200, 260]
  return (
    <View className="absolute inset-0 items-center justify-center">
      <Animated.View
        className="w-[290px] rounded-lor-lg border border-border bg-background p-[10px]"
        entering={FadeIn.duration(300)}
      >
        <View className="h-7 flex-row items-center gap-two border-b border-separator pb-one">
          <Text className="min-w-0 flex-1 text-[12px] font-semibold text-foreground">
            Launch post
          </Text>
          <View className="flex-row">
            {[ZOE, RAFAEL, you].map((person, index) => (
              <Avatar
                className={index === 0 ? "size-5" : "-ml-one size-5"}
                image={person.image}
                key={person.name}
                name={person.name}
                size="xs"
              />
            ))}
          </View>
        </View>
        <View className="mt-two h-[120px] gap-one">
          <View className="h-6">
            {phase >= 3 ? (
              <Animated.View
                className="flex-row items-center gap-two"
                entering={appear}
              >
                <PersonAvatar person={ZOE} />
                <Text className="min-w-0 flex-1 text-[11px] text-foreground">
                  <MentionChip />
                  {WELCOME_ASK}
                </Text>
              </Animated.View>
            ) : null}
          </View>
          <View className="h-9 flex-row gap-two">
            {phase >= 3 ? (
              <>
                <View className="w-6 items-center pt-px">
                  <LorMark size={16} />
                </View>
                <Text className="min-w-0 flex-1 text-[11px] leading-4 text-foreground">
                  <TypewriterText
                    animate
                    text={phase >= 4 ? WELCOME_DRAFT : ""}
                  />
                </Text>
              </>
            ) : null}
          </View>
          <View className="h-4 flex-row pl-eight">
            {phase >= 6 ? (
              <Animated.View
                className="flex-row items-center gap-one rounded-full border border-border px-[6px]"
                entering={appear}
              >
                <HugeiconsIcon color={muted} icon={ThumbsUpIcon} size={10} />
                <Text className="text-[10px] text-muted">1</Text>
              </Animated.View>
            ) : null}
          </View>
          <View className="h-8">
            {phase >= 5 ? (
              <Animated.View
                className="h-full flex-row items-center gap-one rounded-lor-sm border border-border pl-two pr-one"
                entering={appear}
              >
                {approved ? (
                  <>
                    <HugeiconsIcon
                      color={muted}
                      icon={Tick02Icon}
                      size={12}
                      strokeWidth={2}
                    />
                    <Text className="text-[11px] text-muted">
                      Approved by you
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      className="min-w-0 flex-1 text-[11px] text-foreground"
                      numberOfLines={1}
                    >
                      Post to #announcements?
                    </Text>
                    <Text className="px-two text-[10px] text-muted">
                      Reject
                    </Text>
                    <View className="rounded-lor-sm bg-foreground px-two py-[3px]">
                      <Text className="text-[10px] font-medium text-background">
                        Approve
                      </Text>
                    </View>
                  </>
                )}
              </Animated.View>
            ) : null}
          </View>
        </View>
        <View className="mt-two h-7 justify-center rounded-lor-sm border border-border px-two">
          <Text className="text-[11px] text-foreground" numberOfLines={1}>
            {asking ? (
              <>
                <MentionChip />
                <TypewriterText animate text={phase >= 2 ? WELCOME_ASK : ""} />
              </>
            ) : (
              <Text className="text-muted">Reply…</Text>
            )}
          </Text>
        </View>
        <SceneCursor colors={COLOR_ROSE} name="Zoe" x={zoe[0]} y={zoe[1]} />
        <SceneCursor
          colors={{ background: accent, foreground: accentForeground }}
          name="Lor"
          x={lor[0]}
          y={lor[1]}
        />
        <SceneCursor
          colors={COLOR_EMERALD}
          name="Rafael"
          x={rafael[0]}
          y={rafael[1]}
        />
        <SceneCursor
          colors={COLOR_BLUE}
          name={you.name.split(" ")[0] || "You"}
          x={yours[0]}
          y={yours[1]}
        />
      </Animated.View>
    </View>
  )
}

// #gtm, the positioning's first example: Lor drafts, a person approves
// before anything is sent. Same copy as web. Channels have tools (agent
// profiles) and loops, not instructions of their own.
const CHANNEL_LOOP =
  "Find startups hiring a first designer and draft intros. Never send without approval."
// Null is the built-in web search (the globe).
const CHANNEL_TOOLS = [
  { key: null, name: "Web search" },
  { key: "attio", name: "Attio" },
  { key: "notion", name: "Notion" },
] as const
const CHANNEL_TIMES = [400, 800, 1200, 1900, 3500] as const

// The accent layer fades in over the track, so no color math on theme tokens.
function MiniSwitch({ on }: { on: boolean }) {
  const progress = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, { duration: 200 })
  }, [on, progress])
  const fill = useAnimatedStyle(() => ({ opacity: progress.value }))
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 10 }],
  }))
  return (
    <View className="h-3.5 w-6 justify-center overflow-hidden rounded-full bg-default px-0.5">
      <Animated.View className="absolute inset-0 bg-accent" style={fill} />
      <Animated.View
        className="size-2.5 rounded-full bg-background"
        style={thumb}
      />
    </View>
  )
}

// A channel set up once for everyone: its tools switch on, then a loop
// gives Lor work on a schedule.
export function ChannelAgentScene({ you, onDone }: SceneProps) {
  const phase = usePhase(CHANNEL_TIMES, onDone)
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  return (
    <MiniPhone>
      <MiniHeader
        right={
          <View className="flex-row">
            {[ZOE, RAFAEL, you].map((person, index) => (
              <View className={index === 0 ? "" : "-ml-one"} key={person.name}>
                <PersonAvatar person={person} />
              </View>
            ))}
          </View>
        }
        title="# gtm"
      />
      <View className="flex-1 px-three pt-two">
        <Text className="text-[10px] text-muted">Tools</Text>
        <View className="mt-one rounded-lor-sm border border-border">
          {CHANNEL_TOOLS.map((tool, index) => {
            const on = phase >= 1 + index
            return (
              <View
                className={`h-6 flex-row items-center gap-two px-two ${
                  index > 0 ? "border-t border-border" : ""
                }`}
                key={tool.name}
              >
                <View style={{ opacity: on ? 1 : 0.5 }}>
                  <ConnectorIcon
                    color={foreground}
                    connector={tool.key}
                    size={12}
                  />
                </View>
                <Text
                  className={`flex-1 text-[11px] ${
                    on ? "text-foreground" : "text-muted"
                  }`}
                >
                  {tool.name}
                </Text>
                <MiniSwitch on={on} />
              </View>
            )
          })}
        </View>
        <View className="mt-two h-4 flex-row items-center justify-between">
          <Text className="text-[10px] text-muted">Loop</Text>
          {phase >= 4 ? (
            <Animated.View
              className="flex-row items-center gap-one"
              entering={appear}
            >
              <HugeiconsIcon color={muted} icon={RepeatIcon} size={10} />
              <Text className="text-[10px] text-muted">Weekdays at 9:00</Text>
            </Animated.View>
          ) : null}
        </View>
        <View className="mt-one min-h-10 rounded-lor-sm border border-border px-two py-[6px]">
          <Text className="text-[11px] leading-4 text-foreground">
            <TypewriterText animate text={phase >= 4 ? CHANNEL_LOOP : ""} />
          </Text>
        </View>
        <View className="mt-two h-4">
          {phase >= 5 ? (
            <Animated.View
              className="flex-row items-center gap-one"
              entering={appear}
            >
              <LorMark size={12} />
              <Text className="text-[10px] text-muted">
                Shared with everyone in #gtm
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </MiniPhone>
  )
}

// @Lor appears and the question types out with "New session in
// #engineering" under it; the send opens the session: your question with the
// chat it read, Lor working, then its answer.
const START_TIMES = [500, 800, 2300, 3100, 4300] as const

export function SessionStartScene({ you, onDone }: SceneProps) {
  const phase = usePhase(START_TIMES, onDone)
  const inSession = phase >= 3
  const answered = phase >= 5

  const channelPane = (
    <>
      <MiniHeader title="# engineering" />
      <View className="flex-1 justify-end gap-three px-three pb-three">
        <MiniMessage person={ZOE}>
          Deploy is green. Shipping the billing fix after lunch.
        </MiniMessage>
        <MiniMessage person={RAFAEL}>
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
            <MentionChip />
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
          <MentionChip />
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

export function SharedSessionScene({ you, onDone }: SceneProps) {
  const phase = usePhase(SHARED_TIMES, onDone)
  const drafting = phase >= 2 && phase < 4
  return (
    <MiniPhone>
      <MiniHeader
        right={
          <View className="flex-row">
            <PersonAvatar person={you} />
            {phase >= 1 ? (
              <Animated.View className="-ml-one" entering={appear}>
                <PersonAvatar person={RAFAEL} />
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
          <MiniMessage named={false} person={RAFAEL}>
            <MentionChip name={you.name.split(" ")[0] || "you"} /> can you check
            staging too?
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
              subscribers={[RAFAEL_FACE]}
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
