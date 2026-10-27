import LockKeyIcon from "@hugeicons/core-free-icons/LockKeyIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Radio } from "heroui-native/radio"
import { type ReactNode, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import Animated, {
  Easing,
  FadeInLeft,
  FadeInRight,
  useReducedMotion,
} from "react-native-reanimated"
import { MessageContent } from "@/components/message-content"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup } from "@/components/ui/radio-group"
import type { ChannelApproval } from "@/lib/api-types"

// Claude Code's own prompts in a session: its plan (ExitPlanMode) and its
// questions (askUserQuestions). Only the turn's sender decides them; the
// others see them read-only. Mirrors web's approval-card.tsx.

export type Answers = NonNullable<ChannelApproval["answers"]>
type Question = NonNullable<ChannelApproval["questions"]>[number]

// What a Claude Code prompt's decision carries beyond yes or no.
export type ResolveExtra = {
  planMode?: "acceptEdits" | "default"
  answers?: Answers
}

type PromptProps = {
  description: string
  // "Needs your approval", or who decides it.
  statusLine: string
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject", extra?: ResolveExtra) => void
}

// The --ease-out curve, as web's stepper uses.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

export function ApprovalHeader({
  description,
  statusLine,
}: {
  description: string
  statusLine: ReactNode
}) {
  const warning = useThemeColor("warning")
  return (
    <View className="flex-row items-start gap-three">
      <View className="size-7 items-center justify-center rounded-lor-sm bg-warning-soft">
        <HugeiconsIcon
          color={warning}
          icon={LockKeyIcon}
          size={14}
          strokeWidth={2}
        />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[13px] font-medium leading-5 text-foreground">
          {description}
        </Text>
        <Text className="text-xs text-muted">{statusLine}</Text>
      </View>
    </View>
  )
}

// The plan and the choices of Claude Code's own plan dialog. Keep planning
// rejects, so Claude Code goes on planning.
export function PlanApprovalCard({
  plan,
  description,
  statusLine,
  canResolve,
  pending,
  onResolve,
}: PromptProps & { plan: string }) {
  return (
    <View className="gap-three rounded-lor-md border border-border bg-surface p-three">
      <ApprovalHeader description={description} statusLine={statusLine} />
      <ScrollView
        className="rounded-lor-sm border border-border bg-surface-secondary"
        nestedScrollEnabled
        style={{ maxHeight: 320 }}
      >
        <View className="px-three py-two">
          <MessageContent content={plan} mentions={[]} />
        </View>
      </ScrollView>
      {canResolve ? (
        <View className="gap-two">
          <Button
            isDisabled={pending}
            onPress={() => onResolve("approve", { planMode: "acceptEdits" })}
            size="sm"
          >
            Approve and accept edits
          </Button>
          <Button
            isDisabled={pending}
            onPress={() => onResolve("approve", { planMode: "default" })}
            size="sm"
            variant="secondary"
          >
            Approve, ask for edits
          </Button>
          <Button
            isDisabled={pending}
            onPress={() => onResolve("reject")}
            size="sm"
            variant="ghost"
          >
            Keep planning
          </Button>
        </View>
      ) : null}
    </View>
  )
}

// The questions as a stepper, one at a time: pick options or write an answer,
// which Claude Code takes over the options. Skip leaves a question out; with
// none answered the questions are declined and Claude Code goes on.
export function QuestionApprovalCard({
  questions,
  statusLine,
  canResolve,
  pending,
  onResolve,
}: PromptProps & { questions: Question[] }) {
  const [step, setStep] = useState(0)
  // 1 forward, -1 back: the next question comes in from that side.
  const [direction, setDirection] = useState(1)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [written, setWritten] = useState<Record<string, string>>({})
  const reduceMotion = useReducedMotion()
  const [muted, accent] = useThemeColor(["muted", "accent"])
  const question = questions[step]
  if (!question) return null

  const go = (to: number) => {
    setDirection(to > step ? 1 : -1)
    setStep(to)
  }
  const options = question.options ?? []
  const chosen = picked[question.id] ?? []
  const enabled = canResolve && !pending
  const last = step === questions.length - 1
  const answerOf = (id: string) => {
    const freeform = written[id]?.trim()
    if (freeform) return { optionIds: [], freeform }
    const optionIds = picked[id] ?? []
    return optionIds.length > 0 ? { optionIds } : null
  }
  const answered = answerOf(question.id) !== null

  const pick = (optionId: string) => {
    setWritten((current) => ({ ...current, [question.id]: "" }))
    setPicked((current) => {
      const ids = current[question.id] ?? []
      const next = !question.allowMultiple
        ? [optionId]
        : ids.includes(optionId)
          ? ids.filter((id) => id !== optionId)
          : [...ids, optionId]
      return { ...current, [question.id]: next }
    })
  }
  const write = (value: string) => {
    setWritten((current) => ({ ...current, [question.id]: value }))
    if (value.trim()) {
      setPicked((current) => ({ ...current, [question.id]: [] }))
    }
  }
  // `skipped`: the current question, skipped on the last step.
  const submit = (skipped?: string) => {
    const answers: Answers = Object.fromEntries(
      questions.flatMap((q) => {
        const answer = q.id === skipped ? null : answerOf(q.id)
        return answer ? [[q.id, answer]] : []
      })
    )
    if (Object.keys(answers).length === 0) onResolve("reject")
    else onResolve("approve", { answers })
  }
  const skip = () => {
    setPicked((current) => ({ ...current, [question.id]: [] }))
    setWritten((current) => ({ ...current, [question.id]: "" }))
    if (last) submit(question.id)
    else go(step + 1)
  }
  const hint =
    options.length === 0
      ? "Write your answer."
      : question.allowMultiple
        ? "Select all that apply, or write your own."
        : "Choose one, or write your own."
  const entering = reduceMotion
    ? undefined
    : (direction > 0 ? FadeInRight : FadeInLeft).duration(220).easing(EASE_OUT)
  const optionLabel = (option: (typeof options)[number]) => (
    <View className="min-w-0 flex-1 gap-px">
      <Text className="text-[15px] font-medium text-foreground">
        {option.label}
      </Text>
      {option.description ? (
        <Text className="text-xs text-muted">{option.description}</Text>
      ) : null}
    </View>
  )
  const rowClass = (selected: boolean) =>
    `min-h-11 flex-row items-center gap-three rounded-lor-sm px-three py-two ${
      selected ? "bg-surface-tertiary" : "bg-surface-secondary"
    }`

  return (
    <View className="gap-four rounded-lor-md border border-border bg-surface p-four">
      <View className="gap-two">
        {questions.length > 1 ? (
          <View className="flex-row gap-one">
            {questions.map((q, index) => (
              <View
                className={`h-1 flex-1 rounded-full ${
                  index <= step ? "bg-foreground" : "bg-surface-tertiary"
                }`}
                key={q.id}
              />
            ))}
          </View>
        ) : null}
        <Text className="text-xs text-muted">
          {questions.length > 1
            ? `Question ${step + 1} of ${questions.length}`
            : "Claude Code asks"}
          {question.header ? ` · ${question.header}` : ""}
        </Text>
      </View>
      <Animated.View
        className="gap-three"
        entering={entering}
        key={question.id}
      >
        <View className="gap-px">
          <Text className="text-[15px] font-medium leading-6 text-foreground">
            {question.question}
          </Text>
          <Text className="text-sm text-muted">{hint}</Text>
        </View>
        {options.length > 0 && question.allowMultiple ? (
          <View className="gap-two">
            {options.map((option) => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: chosen.includes(option.id) }}
                className={rowClass(chosen.includes(option.id))}
                disabled={!enabled}
                key={option.id}
                onPress={() => pick(option.id)}
              >
                <View pointerEvents="none">
                  <Checkbox
                    isDisabled={!enabled}
                    isSelected={chosen.includes(option.id)}
                  />
                </View>
                {optionLabel(option)}
              </Pressable>
            ))}
          </View>
        ) : options.length > 0 ? (
          <RadioGroup
            className="gap-two"
            isDisabled={!enabled}
            onValueChange={(value) => pick(String(value))}
            value={chosen[0] ?? ""}
          >
            {options.map((option) => (
              <RadioGroup.Item
                className={rowClass(chosen.includes(option.id))}
                key={option.id}
                value={option.id}
              >
                <Radio />
                {optionLabel(option)}
              </RadioGroup.Item>
            ))}
          </RadioGroup>
        ) : null}
        {canResolve ? (
          <TextInput
            accessibilityLabel="Your own answer"
            className="min-h-11 rounded-lor-sm border border-border bg-surface-secondary px-three py-two text-[15px] text-foreground"
            editable={!pending}
            multiline
            onChangeText={write}
            placeholder="Or write your own answer…"
            placeholderTextColor={muted}
            selectionColor={accent}
            style={{ maxHeight: 120 }}
            value={written[question.id] ?? ""}
          />
        ) : null}
      </Animated.View>
      <View className="flex-row items-center gap-two">
        {step > 0 ? (
          <Button
            isDisabled={pending}
            onPress={() => go(step - 1)}
            size="sm"
            variant="ghost"
          >
            Previous
          </Button>
        ) : null}
        <View className="ml-auto flex-row items-center gap-two">
          {canResolve ? (
            <>
              <Button
                isDisabled={pending}
                onPress={skip}
                size="sm"
                variant="ghost"
              >
                Skip
              </Button>
              <Button
                isDisabled={!enabled || !answered}
                onPress={() => (last ? submit() : go(step + 1))}
                size="sm"
              >
                {last ? "Send" : "Next"}
              </Button>
            </>
          ) : (
            <>
              <Text className="text-xs text-muted">{statusLine}</Text>
              {!last ? (
                <Button
                  onPress={() => go(step + 1)}
                  size="sm"
                  variant="outline"
                >
                  Next
                </Button>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  )
}

// One line of what was answered: "Color: Blue".
export function answerSummary(questions: Question[], answers: Answers): string {
  return questions
    .flatMap((question) => {
      const answer = answers[question.id]
      if (!answer) return []
      const value =
        answer.freeform ??
        answer.optionIds
          .map(
            (id) => question.options?.find((option) => option.id === id)?.label
          )
          .filter(Boolean)
          .join(", ")
      return value ? [`${question.header ?? question.question}: ${value}`] : []
    })
    .join("; ")
}
