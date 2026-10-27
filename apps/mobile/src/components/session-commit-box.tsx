import { BottomSheetTextInput } from "@gorhom/bottom-sheet"
import ArrowDown02Icon from "@hugeicons/core-free-icons/ArrowDown02Icon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { usePersonalAccounts } from "@/hooks/use-personal-accounts"
import {
  type ReadyChanges,
  useCommitChanges,
  useCommitMessage,
  usePullChanges,
  usePushChanges,
} from "@/hooks/use-session-changes"

// The Changes tab's foot: a commit message (or the model's draft), Commit,
// Pull and Push, all as the person's own GitHub account. Linking GitHub is on
// web for now. Mirrors web's CommitBox (session-changes-panel.tsx).
export function SessionCommitBox({
  sessionId,
  changes,
  stagedCount,
}: {
  sessionId: string
  changes: ReadyChanges
  stagedCount: number
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [message, setMessage] = useState("")
  const generate = useCommitMessage(sessionId)
  const commit = useCommitChanges(sessionId)
  const push = usePushChanges(sessionId)
  const pull = usePullChanges(sessionId)
  const accounts = usePersonalAccounts()
  // Undefined while loading; null when the person hasn't linked GitHub.
  const account = accounts.data?.github.account
  const unpushed = changes.commits.length
  const blocked = changes.lorWorking
    ? "Lor is working. Commit when it finishes."
    : stagedCount === 0
      ? "Stage files to commit."
      : !message.trim()
        ? "Write a commit message."
        : null
  const submit = () => {
    if (blocked || !account || commit.isPending) return
    commit.mutate(message.trim(), { onSuccess: () => setMessage("") })
  }

  return (
    <View className="gap-two border-t border-separator px-one pb-six pt-two">
      <View className="flex-row items-center gap-one">
        <HugeiconsIcon
          color={muted}
          icon={GitBranchIcon}
          size={14}
          strokeWidth={2}
        />
        <Text className="min-w-0 shrink text-xs text-muted" numberOfLines={1}>
          {changes.branch ?? "detached HEAD"}
          {changes.branch !== changes.baseBranch
            ? ` from ${changes.baseBranch}`
            : ""}
          {unpushed > 0 ? ` · ${unpushed} unpushed` : ""}
        </Text>
        {account && changes.branch ? (
          <Pressable
            accessibilityLabel={`Pull new commits on ${changes.branch} from GitHub`}
            accessibilityRole="button"
            className="ml-auto min-h-8 flex-row items-center gap-one rounded-lor-sm px-two active:bg-surface-secondary"
            disabled={pull.isPending || changes.lorWorking || changes.merging}
            onPress={() => pull.mutate()}
            style={{
              opacity:
                pull.isPending || changes.lorWorking || changes.merging
                  ? 0.4
                  : 1,
            }}
          >
            {pull.isPending ? (
              <Spinner size="sm" />
            ) : (
              <HugeiconsIcon
                color={muted}
                icon={ArrowDown02Icon}
                size={14}
                strokeWidth={2}
              />
            )}
            <Text className="text-xs text-muted">Pull</Text>
          </Pressable>
        ) : null}
      </View>
      {account === null ? (
        <Text className="rounded-lor-sm bg-surface-secondary px-three py-two text-[13px] text-muted">
          Commits are made as your own GitHub account. Link it in Lor on the web
          or desktop to commit and push from here.
        </Text>
      ) : (
        <>
          <View className="flex-row items-start gap-two rounded-lor-sm border border-border bg-surface-secondary px-three py-two">
            <BottomSheetTextInput
              accessibilityLabel="Commit message"
              className="min-h-11 min-w-0 flex-1 p-0 text-[15px] text-foreground"
              multiline
              onChangeText={setMessage}
              placeholder="Commit message"
              placeholderTextColor={muted}
              selectionColor={accent}
              style={{ maxHeight: 120 }}
              value={message}
            />
            <Pressable
              accessibilityHint={
                stagedCount === 0
                  ? "Stage changes first"
                  : "Writes a message from the staged changes"
              }
              accessibilityLabel="Write a commit message"
              accessibilityRole="button"
              className="size-8 items-center justify-center rounded-lor-sm active:bg-surface-tertiary"
              disabled={stagedCount === 0 || generate.isPending}
              onPress={() =>
                generate.mutate(undefined, { onSuccess: setMessage })
              }
              style={{ opacity: stagedCount === 0 ? 0.4 : 1 }}
            >
              {generate.isPending ? (
                <Spinner size="sm" />
              ) : (
                <HugeiconsIcon
                  color={accent}
                  icon={SparklesIcon}
                  size={18}
                  strokeWidth={2}
                />
              )}
            </Pressable>
          </View>
          {blocked ? (
            <Text className="text-xs text-muted">{blocked}</Text>
          ) : null}
          <View className="flex-row gap-two">
            <Button
              className="flex-1"
              isDisabled={Boolean(blocked) || !account || commit.isPending}
              onPress={submit}
              size="sm"
            >
              {commit.isPending
                ? "Committing…"
                : stagedCount > 0
                  ? `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`
                  : "Commit"}
            </Button>
            {account && unpushed > 0 && changes.branch ? (
              <Button
                className="flex-1"
                isDisabled={push.isPending}
                onPress={() => push.mutate()}
                size="sm"
                variant="secondary"
              >
                {push.isPending
                  ? "Pushing…"
                  : `Push ${unpushed} ${unpushed === 1 ? "commit" : "commits"}`}
              </Button>
            ) : null}
          </View>
        </>
      )}
    </View>
  )
}
