import AtSignIcon from "@hugeicons/core-free-icons/AtSignIcon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import LaughingIcon from "@hugeicons/core-free-icons/LaughingIcon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import SentIcon from "@hugeicons/core-free-icons/SentIcon"
import StopIcon from "@hugeicons/core-free-icons/StopIcon"
import TextFontIcon from "@hugeicons/core-free-icons/TextFontIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { Alert } from "heroui-native/alert"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { cn } from "heroui-native/utils"
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Keyboard,
  type LayoutChangeEvent,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
} from "react-native-enriched-markdown"
import { KeyboardController } from "react-native-keyboard-controller"
import Animated, { LinearTransition } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AttachmentPickerPanel } from "@/components/attachment-picker-panel"
import { ComposerAttachmentPreview } from "@/components/composer-attachment-preview"
import { MentionSuggestionMenu } from "@/components/mention-suggestion-menu"
import { messageDisplayName } from "@/components/message-row"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { useMessageAttachments } from "@/hooks/use-message-attachments"
import type { RecentPhoto } from "@/hooks/use-recent-photos"
import type { Message } from "@/lib/api-types"
import { filterMentionCandidates, type MentionCandidate } from "@/lib/mentions"
import {
  MENTION_SCHEME,
  toDisplayMarkdown,
  toStoredMessageMarkdown,
} from "@/lib/message-markdown"

const composerLayoutTransition = LinearTransition.duration(100)
const attachmentPanelGap = 8

export type MessageComposerMentionHandle = {
  insertMention: (mention: { id: string; label: string }) => void
}

export function MessageComposer({
  channelId,
  channelName,
  isSending,
  isConnected,
  onSend,
  onStop,
  isStopping = false,
  placeholder,
  accessibilityLabel,
  initialDraft = "",
  replyingTo,
  onCancelReply,
  editingMessage,
  onCancelEdit,
  onEdit,
  mentionCandidates = [],
  isMentionCandidatesLoading = false,
  mentionCandidatesError = null,
  mentionRef,
  onTyping,
  inputNativeID,
  onInputLayout,
  onCustomInputViewChange,
  topAccessory,
}: {
  channelId: string
  channelName: string
  isSending: boolean
  isConnected: boolean
  onSend: (
    content: string,
    attachments: NonNullable<Message["attachments"]>
  ) => Promise<void>
  onStop?: () => Promise<void> | void
  isStopping?: boolean
  placeholder?: string
  accessibilityLabel?: string
  initialDraft?: string
  replyingTo?: Message | null
  onCancelReply?: () => void
  editingMessage?: Message | null
  onCancelEdit?: () => void
  onEdit?: (messageId: string, content: string) => Promise<void>
  mentionCandidates?: MentionCandidate[]
  isMentionCandidatesLoading?: boolean
  mentionCandidatesError?: string | null
  mentionRef?: Ref<MessageComposerMentionHandle>
  onTyping?: () => void
  inputNativeID?: string
  onInputLayout?: (event: LayoutChangeEvent) => void
  onCustomInputViewChange?: (isOpen: boolean) => void
  // Rendered flush above the input card so accessories (run queue) can tuck
  // behind its top edge.
  topAccessory?: ReactNode
}) {
  const { bottom: bottomInset } = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const [accent, danger, foreground, muted, placeholderColor] = useThemeColor([
    "accent",
    "danger",
    "foreground",
    "muted",
    "field-placeholder",
  ])
  const inputRef = useRef<EnrichedMarkdownTextInputInstance>(null)
  const focusStateFrameRef = useRef<number | null>(null)
  const onTypingRef = useRef(onTyping)
  onTypingRef.current = onTyping
  const activeEditingMessageIdRef = useRef<string | null>(null)
  const draftBeforeEditRef = useRef<{
    content: string
    plainText: string
  } | null>(null)
  const attachmentUpload = useMessageAttachments(channelId)
  const mentionMenuOpenRef = useRef(false)
  const [content, setContent] = useState(initialDraft)
  const [plainText, setPlainText] = useState(initialDraft)
  const contentRef = useRef(content)
  const plainTextRef = useRef(plainText)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false)
  const [isAttachmentPickerOpen, setIsAttachmentPickerOpen] = useState(false)
  const [attachmentPickerHeight, setAttachmentPickerHeight] = useState(320)
  const [mentionQuery, setMentionQuery] = useState("")
  contentRef.current = content
  plainTextRef.current = plainText
  const isEditing = Boolean(editingMessage)
  const hasMessage = plainText.trim().length > 0
  const hasUploadedAttachments = attachmentUpload.uploadedAttachments.length > 0
  const pendingStoredContent = toStoredMessageMarkdown(content).trim()
  const canSaveEdit =
    isEditing &&
    Boolean(onEdit) &&
    hasMessage &&
    pendingStoredContent !== editingMessage?.content?.trim()
  const canSend =
    (isEditing
      ? canSaveEdit
      : (hasMessage || hasUploadedAttachments) &&
        !attachmentUpload.hasError &&
        !attachmentUpload.isUploading) &&
    !isSending &&
    isConnected
  const isStopMode =
    Boolean(onStop) &&
    !isEditing &&
    !hasMessage &&
    attachmentUpload.attachments.length === 0
  const canActivateSubmit = isStopMode ? !isStopping : canSend
  const isExpanded =
    isEditing ||
    isFocused ||
    isAttachmentPickerOpen ||
    plainText.length > 0 ||
    attachmentUpload.attachments.length > 0

  // Avoid committing React state in the same frame that starts the native
  // keyboard animation; that can suppress Reanimated's first iOS update.
  const scheduleFocusState = useCallback((isInputFocused: boolean) => {
    if (focusStateFrameRef.current !== null) {
      cancelAnimationFrame(focusStateFrameRef.current)
    }
    focusStateFrameRef.current = requestAnimationFrame(() => {
      focusStateFrameRef.current = null
      setIsFocused(isInputFocused)
    })
  }, [])

  const filteredMentionCandidates = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionQuery),
    [mentionCandidates, mentionQuery]
  )

  const markdownStyle = useMemo(
    () => ({
      strong: { color: foreground },
      em: { color: foreground },
      link: { color: accent, backgroundColor: "transparent", underline: false },
      linkVariants: {
        "^lor://mention/": {
          color: accent,
          backgroundColor: "transparent",
          underline: false,
        },
      },
    }),
    [accent, foreground]
  )

  const inputStyle = useMemo(
    () => ({
      width: "100%" as const,
      minHeight: isExpanded ? 56 : 48,
      maxHeight: 120,
      paddingLeft: isExpanded ? 16 : 52,
      paddingRight: isExpanded ? 16 : 60,
      paddingTop: 12,
      paddingBottom: isExpanded ? 8 : 12,
      backgroundColor: "transparent",
      color: foreground,
      fontSize: 16,
      lineHeight: 21,
      textAlignVertical: "top" as const,
    }),
    [foreground, isExpanded]
  )

  const closeMentionMenu = useCallback(() => {
    mentionMenuOpenRef.current = false
    setIsMentionMenuOpen(false)
    setMentionQuery("")
  }, [])

  const openMentionMenu = useCallback(() => {
    if (!mentionMenuOpenRef.current) {
      mentionMenuOpenRef.current = true
      triggerHaptic("soft")
    }
    setIsMentionMenuOpen(true)
  }, [])

  useEffect(() => {
    const editingMessageId = editingMessage?.id ?? null
    const activeEditingMessageId = activeEditingMessageIdRef.current

    if (
      editingMessage &&
      editingMessageId &&
      editingMessageId !== activeEditingMessageId
    ) {
      if (!activeEditingMessageId) {
        draftBeforeEditRef.current = {
          content: contentRef.current,
          plainText: plainTextRef.current,
        }
      }

      const editContent = toDisplayMarkdown(
        editingMessage.content,
        editingMessage.mentions
      )
      activeEditingMessageIdRef.current = editingMessageId
      setContent(editContent)
      setPlainText(editContent)
      setSubmitError(null)
      setIsAttachmentPickerOpen(false)
      onCustomInputViewChange?.(false)
      closeMentionMenu()
      inputRef.current?.setValue(editContent)

      const timeout = setTimeout(() => inputRef.current?.focus(), 220)
      return () => clearTimeout(timeout)
    }

    if (!editingMessageId && activeEditingMessageId) {
      const draft = draftBeforeEditRef.current ?? {
        content: "",
        plainText: "",
      }
      activeEditingMessageIdRef.current = null
      draftBeforeEditRef.current = null
      setContent(draft.content)
      setPlainText(draft.plainText)
      setSubmitError(null)
      inputRef.current?.setValue(draft.content)
    }
  }, [closeMentionMenu, editingMessage, onCustomInputViewChange])

  const startMention = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.startMention("@")
  }, [])

  const closeAttachmentPicker = useCallback(() => {
    setIsAttachmentPickerOpen(false)
    onCustomInputViewChange?.(false)
  }, [onCustomInputViewChange])

  const returnToKeyboard = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!(isAttachmentPickerOpen && isFocused)) return

    const subscription = Keyboard.addListener(
      "keyboardDidShow",
      closeAttachmentPicker
    )
    const timeout = setTimeout(closeAttachmentPicker, 650)

    return () => {
      subscription.remove()
      clearTimeout(timeout)
    }
  }, [closeAttachmentPicker, isAttachmentPickerOpen, isFocused])

  const openAttachmentPicker = useCallback(() => {
    closeMentionMenu()
    const keyboardHeight = KeyboardController.state().height
    const fallbackHeight = Math.min(Math.max(windowHeight * 0.36, 260), 340)
    const nextHeight =
      keyboardHeight > 0
        ? keyboardHeight - bottomInset - attachmentPanelGap
        : fallbackHeight - attachmentPanelGap

    onCustomInputViewChange?.(true)
    setAttachmentPickerHeight(Math.min(Math.max(nextHeight, 250), 360))
    setIsAttachmentPickerOpen(true)

    requestAnimationFrame(() => {
      inputRef.current?.blur()
      Keyboard.dismiss()
      void KeyboardController.dismiss().catch(() => undefined)
    })
  }, [bottomInset, closeMentionMenu, onCustomInputViewChange, windowHeight])

  useEffect(
    () => () => {
      if (focusStateFrameRef.current !== null) {
        cancelAnimationFrame(focusStateFrameRef.current)
      }
      onCustomInputViewChange?.(false)
    },
    [onCustomInputViewChange]
  )

  const selectRecentPhoto = useCallback(
    (photo: RecentPhoto) => {
      void attachmentUpload.addPhotoAssets([photo])
    },
    [attachmentUpload]
  )

  const selectedPhotoUris = useMemo(
    () =>
      new Set(
        attachmentUpload.attachments.map((item) => item.sourceUri ?? item.uri)
      ),
    [attachmentUpload.attachments]
  )

  const insertMention = useCallback(
    (candidate: MentionCandidate) => {
      inputRef.current?.insertMention(
        `@${candidate.label}`,
        `${MENTION_SCHEME}${candidate.id}`
      )
      closeMentionMenu()
    },
    [closeMentionMenu]
  )

  useImperativeHandle(
    mentionRef,
    () => ({
      // insertMention is a native no-op without an active mention session,
      // so start one (inserts the "@") and immediately complete it.
      insertMention: ({ id, label }) => {
        inputRef.current?.focus()
        inputRef.current?.startMention("@")
        inputRef.current?.insertMention(`@${label}`, `${MENTION_SCHEME}${id}`)
      },
    }),
    []
  )

  const send = async () => {
    if (!canSend) return
    const next = (await inputRef.current?.getMarkdown()) ?? content
    const nextPlainText = plainText
    const storedContent = toStoredMessageMarkdown(next).trim()
    if (isEditing && editingMessage && onEdit) {
      if (!storedContent || storedContent === editingMessage.content?.trim()) {
        return
      }

      setSubmitError(null)
      try {
        await onEdit(editingMessage.id, storedContent)
      } catch (cause) {
        setSubmitError(
          cause instanceof Error
            ? cause.message
            : "Could not edit this message. Please try again."
        )
        inputRef.current?.focus()
      }
      return
    }

    if (!storedContent && !hasUploadedAttachments) return

    setContent("")
    setPlainText("")
    inputRef.current?.setValue("")
    closeMentionMenu()
    setSubmitError(null)
    try {
      await onSend(storedContent, attachmentUpload.uploadedAttachments)
      attachmentUpload.clearAttachments()
    } catch (cause) {
      setContent(next)
      setPlainText(nextPlainText)
      inputRef.current?.setValue(next)
      inputRef.current?.focus()
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "Could not send this message. Please try again."
      )
    }
  }

  return (
    <View className="bg-background px-three pb-three pt-two">
      {!isConnected ? (
        <Alert
          className="mb-two rounded-lor-sm bg-warning-soft p-two shadow-none"
          status="warning"
        >
          <Alert.Indicator className="pt-px" iconProps={{ size: 16 }} />
          <Alert.Content>
            <Alert.Title className="text-sm">Reconnecting…</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      {attachmentUpload.error ? (
        <Alert
          className="mb-two rounded-lor-sm bg-danger-soft p-two shadow-none"
          status="danger"
        >
          <Alert.Indicator className="pt-px" iconProps={{ size: 16 }} />
          <Alert.Content>
            <Alert.Title className="text-sm">
              {attachmentUpload.error}
            </Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      {submitError ? (
        <Alert
          className="mb-two rounded-lor-sm bg-danger-soft p-two shadow-none"
          status="danger"
        >
          <Alert.Indicator className="pt-px" iconProps={{ size: 16 }} />
          <Alert.Content>
            <Alert.Title className="text-sm">{submitError}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      {isMentionMenuOpen ? (
        <MentionSuggestionMenu
          candidates={filteredMentionCandidates}
          error={mentionCandidatesError}
          isLoading={isMentionCandidatesLoading}
          onSelect={insertMention}
        />
      ) : null}
      {topAccessory}
      <Animated.View
        className="relative overflow-hidden rounded-lor-sm border border-border bg-surface"
        layout={composerLayoutTransition}
        onLayout={onInputLayout}
      >
        {editingMessage ? (
          <View className="min-h-10 flex-row items-center gap-two border-b border-border px-three py-two">
            <View className="w-[3px] self-stretch rounded-full bg-accent" />
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold text-accent">
                Editing message
              </Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                Save changes or cancel to return to your draft.
              </Text>
            </View>
            <IconButton
              accessibilityLabel="Cancel editing"
              onPress={onCancelEdit}
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon color={muted} icon={Cancel01Icon} size={16} />
            </IconButton>
          </View>
        ) : replyingTo ? (
          <View className="min-h-10 flex-row items-center gap-two border-b border-border px-three py-two">
            <View className="w-[3px] self-stretch rounded-full bg-accent" />
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold text-accent">
                Replying to {messageDisplayName(replyingTo)}
              </Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {replyingTo.content ?? "Message"}
              </Text>
            </View>
            <IconButton
              accessibilityLabel="Cancel reply"
              onPress={onCancelReply}
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon color={muted} icon={Cancel01Icon} size={16} />
            </IconButton>
          </View>
        ) : null}
        {!isEditing ? (
          <ComposerAttachmentPreview
            attachments={attachmentUpload.attachments}
            onRemove={attachmentUpload.removeAttachment}
            onRetry={attachmentUpload.retryAttachment}
          />
        ) : null}
        <EnrichedMarkdownTextInput
          accessibilityLabel={
            isEditing
              ? "Edit message"
              : (accessibilityLabel ?? `Message ${channelName}`)
          }
          autoCapitalize="sentences"
          cursorColor={accent}
          editable={isConnected && !isSending}
          markdownStyle={markdownStyle}
          mentionIndicators={["@"]}
          multiline
          nativeID={inputNativeID}
          onBlur={() => {
            scheduleFocusState(false)
            closeMentionMenu()
          }}
          onChangeMarkdown={(markdown) => {
            setContent(markdown)
            if (submitError) setSubmitError(null)
          }}
          onChangeMention={({ text }) => {
            setMentionQuery(text)
            openMentionMenu()
          }}
          onChangeText={(text) => {
            setPlainText(text)
            if (text.length > 0 && !isEditing) onTypingRef.current?.()
          }}
          onEndMention={closeMentionMenu}
          onFocus={() => {
            scheduleFocusState(true)
          }}
          onStartMention={() => {
            setMentionQuery("")
            openMentionMenu()
          }}
          placeholder={
            isEditing
              ? "Edit message"
              : (placeholder ?? `Message #${channelName}`)
          }
          placeholderTextColor={placeholderColor}
          ref={inputRef}
          defaultValue={initialDraft}
          scrollEnabled
          selectionColor={accent}
          style={inputStyle}
        />
        {isExpanded ? (
          <View className="min-h-10 flex-row items-center gap-one px-two pb-two">
            {!isEditing ? (
              <ComposerShortcut
                accessibilityLabel={
                  isAttachmentPickerOpen ? "Show keyboard" : "Add attachment"
                }
                color={isAttachmentPickerOpen ? foreground : muted}
                emphasized
                icon={isAttachmentPickerOpen ? Cancel01Icon : PlusSignIcon}
                onPress={
                  isAttachmentPickerOpen
                    ? returnToKeyboard
                    : openAttachmentPicker
                }
              />
            ) : null}
            <ComposerShortcut color={muted} icon={TextFontIcon} />
            <ComposerShortcut color={muted} icon={LaughingIcon} />
            <ComposerShortcut
              accessibilityLabel="Mention someone"
              color={muted}
              icon={AtSignIcon}
              onPress={startMention}
            />
            <ComposerShortcut color={muted} icon={CommandLineIcon} />
            <ComposerSendButton
              accessibilityLabel={
                isStopMode
                  ? isStopping
                    ? "Stopping Lor"
                    : "Stop Lor"
                  : isEditing
                    ? "Save message changes"
                    : "Send message"
              }
              activeColor={isStopMode ? danger : accent}
              canSend={canActivateSubmit}
              className="ml-auto"
              icon={isStopMode ? StopIcon : isEditing ? Tick02Icon : SentIcon}
              isSending={isStopMode ? isStopping : isSending}
              muted={muted}
              onPress={() => {
                if (isStopMode) void onStop?.()
                else void send()
              }}
            />
          </View>
        ) : (
          <>
            <View className="absolute bottom-two left-two">
              <ComposerShortcut
                accessibilityLabel="Add attachment"
                color={muted}
                emphasized
                icon={PlusSignIcon}
                onPress={openAttachmentPicker}
              />
            </View>
            <ComposerSendButton
              accessibilityLabel={
                isStopMode
                  ? isStopping
                    ? "Stopping Lor"
                    : "Stop Lor"
                  : "Send message"
              }
              activeColor={isStopMode ? danger : accent}
              canSend={canActivateSubmit}
              className="absolute bottom-one right-one"
              icon={isStopMode ? StopIcon : SentIcon}
              isSending={isStopMode ? isStopping : isSending}
              muted={muted}
              onPress={() => {
                if (isStopMode) void onStop?.()
                else void send()
              }}
            />
          </>
        )}
      </Animated.View>
      {isAttachmentPickerOpen && !isEditing ? (
        <AttachmentPickerPanel
          height={attachmentPickerHeight}
          onPickFiles={attachmentUpload.pickFiles}
          onPickMedia={attachmentUpload.pickMedia}
          onSelectPhoto={selectRecentPhoto}
          onTakeMedia={attachmentUpload.takeMedia}
          selectedPhotoUris={selectedPhotoUris}
        />
      ) : null}
    </View>
  )
}

function ComposerShortcut({
  accessibilityLabel,
  color,
  emphasized = false,
  icon,
  onPress,
}: {
  accessibilityLabel?: string
  color: string
  emphasized?: boolean
  icon: IconSvgElement
  onPress?: () => void
}) {
  if (onPress && accessibilityLabel) {
    return (
      <IconButton
        accessibilityLabel={accessibilityLabel}
        className="size-8"
        onPress={onPress}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon color={color} icon={icon} size={18} />
      </IconButton>
    )
  }

  return (
    <View
      accessibilityElementsHidden
      className={`size-8 items-center justify-center rounded-lor-sm ${
        emphasized ? "bg-default" : ""
      }`}
      importantForAccessibility="no-hide-descendants"
    >
      <HugeiconsIcon color={color} icon={icon} size={18} />
    </View>
  )
}

function ComposerSendButton({
  accessibilityLabel,
  activeColor,
  canSend,
  className,
  icon,
  isSending,
  muted,
  onPress,
}: {
  accessibilityLabel: string
  activeColor: string
  canSend: boolean
  className?: string
  icon: IconSvgElement
  isSending: boolean
  muted: string
  onPress: () => void
}) {
  return (
    <IconButton
      accessibilityLabel={accessibilityLabel}
      className={cn("active:bg-surface-tertiary", className)}
      feedbackVariant="scale"
      isDisabled={!canSend}
      onPress={onPress}
      variant="secondary"
    >
      {isSending ? (
        <Spinner color={activeColor} size="sm" />
      ) : (
        <HugeiconsIcon
          color={canSend ? activeColor : muted}
          icon={icon}
          size={16}
        />
      )}
    </IconButton>
  )
}
