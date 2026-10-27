import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon"
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useMemo, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { FileChip } from "@/components/file-chip"
import { PlanStepList } from "@/components/plan-ui"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { useWorkspace } from "@/context/workspace-context"
import {
  useAgentSession,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"
import { usePlanForThread } from "@/hooks/use-plans"
import { api } from "@/lib/api"
import type { AgentSession, Message, SessionFiles } from "@/lib/api-types"
import { fetchMessageLocation, openMessageAt } from "@/lib/message-location"
import { type FileTarget, openFile } from "@/lib/open-file"

type SessionFile = {
  key: string
  name: string
  size: number | null
  target: FileTarget
}

// Archiving a session Lor is working in stops the run, so it asks first.
// Web's archive-session-dialog copy.
export function confirmArchiveSession(
  lorRunning: boolean,
  archive: () => void
) {
  if (!lorRunning) {
    archive()
    return
  }
  Alert.alert(
    "Archive this session?",
    "Lor is still working. Archiving stops it and closes the session for everyone.",
    [
      { style: "cancel", text: "Cancel" },
      { style: "destructive", text: "Archive", onPress: archive },
    ]
  )
}

// Every file the session has (the files API), plus files in loaded messages
// that landed since it was fetched. Messages are walked oldest first, so a
// file Lor rewrote keeps its latest version and moves to the top. Lor's files
// come first, then what people shared. Mirrors web's session-work-panel.
function collectSessionFiles(
  messages: Message[],
  files: SessionFiles | undefined
) {
  const live = new Map<string, SessionFile>()
  const sources = new Map<string, SessionFile>(
    files?.sources.map((file) => [
      file.url,
      {
        key: file.url,
        name: file.filename,
        size: file.size,
        target: { messageId: file.messageId, index: file.index },
      },
    ])
  )
  const oldestFirst = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  for (const message of oldestFirst) {
    for (const call of message.lorToolCalls ?? []) {
      for (const file of call.files ?? []) {
        live.delete(file.artifactId)
        live.set(file.artifactId, {
          key: file.artifactId,
          name: file.path,
          size: file.size,
          target: { artifactId: file.artifactId },
        })
      }
    }
    for (const [index, attachment] of (message.attachments ?? []).entries()) {
      if (sources.has(attachment.url)) continue
      sources.set(attachment.url, {
        key: attachment.url,
        name: attachment.filename,
        size: attachment.size,
        target: { messageId: message.id, index },
      })
    }
  }
  const outputs = new Map([...live].reverse())
  for (const file of files?.outputs ?? []) {
    if (outputs.has(file.id)) continue
    outputs.set(file.id, {
      key: file.id,
      name: file.path,
      size: file.size,
      target: { artifactId: file.id },
    })
  }
  return [...outputs.values(), ...sources.values()]
}

// The session screen's "…": its details (the context it started from, plan,
// files) and actions (rename, archive). Web shows the details in the right
// panel and the actions in the session strip.
export function SessionSheet({
  session,
  messages,
  isOpen,
  onOpenChange,
  lorRunning,
}: {
  session: AgentSession
  // The loaded transcript, for the files Lor made and people attached.
  messages: Message[]
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  lorRunning: boolean
}) {
  const placeholder = useThemeColor("field-placeholder")
  const { workspace } = useWorkspace()
  const updateSession = useUpdateAgentSession()
  const { data: detail } = useAgentSession(session.id)
  const plan = usePlanForThread(session.channelId, session.threadRootId)
  // A code session: repo files are on web's Files tab, and only Lor's own
  // agent makes plans (Claude Code and Codex keep their own task lists).
  const code = session.mode === "code"
  const showPlan = !code || session.harness === "pi"
  const { data: sessionFiles } = useQuery({
    queryKey: ["agent-session-files", session.id],
    enabled: isOpen && !code,
    queryFn: async (): Promise<SessionFiles> => {
      const response = await api.v1.sessions[":sessionId"].files.$get({
        param: { sessionId: session.id },
      })
      if (!response.ok) throw new Error("Couldn't load session files")
      return response.json()
    },
  })
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(session.title)
  const archived = session.archivedAt !== null
  const change = {
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    sessionId: session.id,
  }
  const files = useMemo(
    () => collectSessionFiles(messages, sessionFiles),
    [messages, sessionFiles]
  )
  const steps = plan?.steps ?? []
  const doneCount =
    plan?.status === "completed"
      ? steps.length
      : steps.filter((step) => step.status === "done").length
  const context = detail?.context ?? []
  const newestContext = context.at(-1)
  const source = detail?.source ?? null

  const close = (next: boolean) => {
    if (!next) setRenaming(false)
    onOpenChange(next)
  }
  const saveTitle = () => {
    const next = title.trim()
    close(false)
    if (next && next !== session.title) {
      updateSession.mutate({ ...change, title: next })
    }
  }
  // The messages the session started with, where they were said.
  const openContext = async () => {
    if (!workspace || !newestContext) return
    close(false)
    const location = await fetchMessageLocation(
      workspace.slug,
      newestContext.id
    )
    if (!location) {
      Alert.alert(
        "Couldn't find that conversation",
        "It may have been deleted."
      )
      return
    }
    openMessageAt(location, newestContext.id)
  }

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={close}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          // The composer's keyboard would cover the sheet.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["60%", "92%"]}
        >
          <View className="flex-row items-start gap-three px-one pb-four">
            <View className="min-w-0 flex-1 gap-px">
              <BottomSheet.Title numberOfLines={2}>
                {renaming ? "Rename session" : session.title}
              </BottomSheet.Title>
            </View>
            <BottomSheet.Close />
          </View>
          {renaming ? (
            <View className="gap-three px-one pb-six">
              <BottomSheetTextInput
                accessibilityLabel="Session title"
                autoFocus
                className="min-h-12 rounded-lor-sm border border-border bg-surface px-three text-base text-foreground"
                maxLength={200}
                onChangeText={setTitle}
                onSubmitEditing={saveTitle}
                placeholderTextColor={placeholder}
                returnKeyType="done"
                selectTextOnFocus
                value={title}
              />
              <Button isDisabled={!title.trim()} onPress={saveTitle}>
                Save
              </Button>
            </View>
          ) : (
            <BottomSheetScrollView
              contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              {source ? (
                <Section title="Context">
                  <SourceRow
                    forked={session.forkedFromMessageId !== null}
                    onPress={() => {
                      close(false)
                      router.push({
                        pathname: "/session/[sessionId]",
                        params: session.forkedFromMessageId
                          ? {
                              sessionId: source.id,
                              focusMessageId: session.forkedFromMessageId,
                            }
                          : { sessionId: source.id },
                      })
                    }}
                    title={source.title}
                  />
                </Section>
              ) : newestContext ? (
                <Section title="Context">
                  <ContextRow
                    channelName={detail?.channel.name ?? "channel"}
                    count={context.length}
                    onPress={() => void openContext()}
                  />
                </Section>
              ) : null}
              {showPlan ? (
                <Section
                  meta={
                    steps.length > 0
                      ? `${doneCount}/${steps.length}`
                      : undefined
                  }
                  title="Plan"
                >
                  {steps.length > 0 ? (
                    <PlanStepList items={steps} />
                  ) : (
                    <Empty>No plan yet</Empty>
                  )}
                </Section>
              ) : null}
              {code ? null : (
                <Section
                  meta={files.length > 0 ? String(files.length) : undefined}
                  title="Files"
                >
                  {files.length > 0 ? (
                    <View className="gap-one">
                      {files.map((file) => (
                        <FileChip
                          key={file.key}
                          name={file.name}
                          onPress={() => {
                            close(false)
                            openFile(file.target)
                          }}
                          size={file.size}
                        />
                      ))}
                    </View>
                  ) : (
                    <Empty>No files yet</Empty>
                  )}
                </Section>
              )}
              <View className="gap-two border-t border-separator px-one pt-five">
                {archived ? null : (
                  <ActionRow
                    detail="Your title replaces Lor's"
                    icon={PencilEdit02Icon}
                    label="Rename"
                    onPress={() => {
                      setTitle(session.title)
                      setRenaming(true)
                    }}
                  />
                )}
                <ActionRow
                  detail={
                    archived
                      ? "Back under the channel for its subscribers"
                      : "Leaves everyone's Channels tab"
                  }
                  icon={archived ? ArchiveRestoreIcon : Archive02Icon}
                  label={archived ? "Unarchive" : "Archive"}
                  onPress={() => {
                    triggerHaptic("soft")
                    close(false)
                    if (archived) {
                      updateSession.mutate({ ...change, archived: false })
                      return
                    }
                    confirmArchiveSession(lorRunning, () => {
                      updateSession.mutate({ ...change, archived: true })
                      // Nothing left to do here; back to where you came from.
                      if (router.canGoBack()) router.back()
                    })
                  }}
                />
              </View>
            </BottomSheetScrollView>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function Section({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <View className="gap-two px-one">
      <Text className="text-xs font-medium text-muted">
        {title}
        {meta ? <Text className="text-muted opacity-70"> {meta}</Text> : null}
      </Text>
      {children}
    </View>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-muted opacity-70">{children}</Text>
}

// A link to where the session's background was said, rather than a copy.
function ContextRow({
  channelName,
  count,
  onPress,
}: {
  channelName: string
  count: number
  onPress: () => void
}) {
  const muted = useThemeColor("muted")
  return (
    <Pressable
      accessibilityHint="Opens the messages the session started from"
      accessibilityRole="link"
      className="min-h-9 flex-row items-center gap-one self-start rounded-lor-sm active:opacity-60"
      onPress={onPress}
    >
      <HugeiconsIcon color={muted} icon={HashtagIcon} size={14} />
      <Text className="text-sm text-foreground">{channelName}</Text>
      <Text className="text-xs text-muted">
        {count} {count === 1 ? "message" : "messages"}
      </Text>
    </Pressable>
  )
}

// "Continue in Code" or a fork: the session this one comes from.
function SourceRow({
  title,
  forked,
  onPress,
}: {
  title: string
  forked: boolean
  onPress: () => void
}) {
  const muted = useThemeColor("muted")
  return (
    <Pressable
      accessibilityRole="link"
      className="min-h-9 flex-row items-center gap-one self-start rounded-lor-sm active:opacity-60"
      onPress={onPress}
    >
      <HugeiconsIcon
        color={muted}
        icon={forked ? GitForkIcon : BubbleChatIcon}
        size={14}
      />
      <Text className="text-xs text-muted">
        {forked ? "Forked from" : "Continued from"}
      </Text>
      <Text className="shrink text-sm text-foreground" numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  )
}

function ActionRow({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  const foreground = useThemeColor("foreground")
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
        <HugeiconsIcon color={foreground} icon={icon} size={19} />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs leading-4 text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  )
}
