import AtSignIcon from "@hugeicons/core-free-icons/AtSignIcon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import LaughingIcon from "@hugeicons/core-free-icons/LaughingIcon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import SentIcon from "@hugeicons/core-free-icons/SentIcon"
import TextFontIcon from "@hugeicons/core-free-icons/TextFontIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { Alert } from "heroui-native/alert"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useMemo, useRef, useState } from "react"
import { Text, View } from "react-native"
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
} from "react-native-enriched-markdown"
import { KeyboardController } from "react-native-keyboard-controller"
import Animated, { LinearTransition } from "react-native-reanimated"
import { AttachmentPickerSheet } from "@/components/attachment-picker-sheet"
import { ComposerAttachmentPreview } from "@/components/composer-attachment-preview"
import { MentionSuggestionMenu } from "@/components/mention-suggestion-menu"
import { messageDisplayName } from "@/components/message-row"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { useMessageAttachments } from "@/hooks/use-message-attachments"
import type { Message } from "@/lib/api-types"
import { filterMentionCandidates, type MentionCandidate } from "@/lib/mentions"
import { MENTION_SCHEME, toStoredMessageMarkdown } from "@/lib/message-markdown"

const composerLayoutTransition = LinearTransition.duration(100)

export function MessageComposer({
  channelId,
  channelName,
  isSending,
  isConnected,
  onSend,
  placeholder,
  accessibilityLabel,
  replyingTo,
  onCancelReply,
  mentionCandidates = [],
  isMentionCandidatesLoading = false,
  mentionCandidatesError = null,
}: {
  channelId: string
  channelName: string
  isSending: boolean
  isConnected: boolean
  onSend: (
    content: string,
    attachments: NonNullable<Message["attachments"]>
  ) => Promise<void>
  placeholder?: string
  accessibilityLabel?: string
  replyingTo?: Message | null
  onCancelReply?: () => void
  mentionCandidates?: MentionCandidate[]
  isMentionCandidatesLoading?: boolean
  mentionCandidatesError?: string | null
}) {
  const [accent, foreground, muted, placeholderColor] = useThemeColor([
    "accent",
    "foreground",
    "muted",
    "field-placeholder",
  ])
  const inputRef = useRef<EnrichedMarkdownTextInputInstance>(null)
  const attachmentUpload = useMessageAttachments(channelId)
  const mentionMenuOpenRef = useRef(false)
  const [content, setContent] = useState("")
  const [plainText, setPlainText] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false)
  const [isAttachmentPickerOpen, setIsAttachmentPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState("")
  const hasMessage = plainText.trim().length > 0
  const hasUploadedAttachments = attachmentUpload.uploadedAttachments.length > 0
  const canSend =
    (hasMessage || hasUploadedAttachments) &&
    !attachmentUpload.hasError &&
    !attachmentUpload.isUploading &&
    !isSending &&
    isConnected
  const isExpanded =
    isFocused || plainText.length > 0 || attachmentUpload.attachments.length > 0

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

  const startMention = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.startMention("@")
  }, [])

  const openAttachmentPicker = useCallback(async () => {
    closeMentionMenu()
    await KeyboardController.dismiss()
    setIsAttachmentPickerOpen(true)
  }, [closeMentionMenu])

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

  const send = async () => {
    if (!canSend) return
    const next = (await inputRef.current?.getMarkdown()) ?? content
    const nextPlainText = plainText
    const storedContent = toStoredMessageMarkdown(next).trim()
    if (!storedContent && !hasUploadedAttachments) return

    setContent("")
    setPlainText("")
    inputRef.current?.setValue("")
    closeMentionMenu()
    try {
      await onSend(storedContent, attachmentUpload.uploadedAttachments)
      attachmentUpload.clearAttachments()
    } catch {
      setContent(next)
      setPlainText(nextPlainText)
      inputRef.current?.setValue(next)
      inputRef.current?.focus()
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
      {isMentionMenuOpen ? (
        <MentionSuggestionMenu
          candidates={filteredMentionCandidates}
          error={mentionCandidatesError}
          isLoading={isMentionCandidatesLoading}
          onSelect={insertMention}
        />
      ) : null}
      <Animated.View
        className="relative overflow-hidden rounded-lor-sm border border-border bg-surface"
        layout={composerLayoutTransition}
      >
        {replyingTo ? (
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
        <ComposerAttachmentPreview
          attachments={attachmentUpload.attachments}
          onRemove={attachmentUpload.removeAttachment}
          onRetry={attachmentUpload.retryAttachment}
        />
        <EnrichedMarkdownTextInput
          accessibilityLabel={accessibilityLabel ?? `Message ${channelName}`}
          autoCapitalize="sentences"
          cursorColor={accent}
          editable={isConnected && !isSending}
          markdownStyle={markdownStyle}
          mentionIndicators={["@"]}
          multiline
          onBlur={() => {
            setIsFocused(false)
            closeMentionMenu()
          }}
          onChangeMarkdown={setContent}
          onChangeMention={({ text }) => {
            setMentionQuery(text)
            openMentionMenu()
          }}
          onChangeText={setPlainText}
          onEndMention={closeMentionMenu}
          onFocus={() => setIsFocused(true)}
          onStartMention={() => {
            setMentionQuery("")
            openMentionMenu()
          }}
          placeholder={placeholder ?? `Message #${channelName}`}
          placeholderTextColor={placeholderColor}
          ref={inputRef}
          scrollEnabled
          selectionColor={accent}
          style={inputStyle}
        />
        {isExpanded ? (
          <View className="min-h-10 flex-row items-center gap-one px-two pb-two">
            <ComposerShortcut
              accessibilityLabel="Add attachment"
              color={muted}
              emphasized
              icon={PlusSignIcon}
              onPress={() => void openAttachmentPicker()}
            />
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
              accent={accent}
              canSend={canSend}
              className="ml-auto"
              isSending={isSending}
              muted={muted}
              onPress={() => void send()}
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
                onPress={() => void openAttachmentPicker()}
              />
            </View>
            <ComposerSendButton
              accent={accent}
              canSend={canSend}
              className="absolute bottom-one right-one"
              isSending={isSending}
              muted={muted}
              onPress={() => void send()}
            />
          </>
        )}
      </Animated.View>
      <AttachmentPickerSheet
        isOpen={isAttachmentPickerOpen}
        onOpenChange={setIsAttachmentPickerOpen}
        onPickFiles={attachmentUpload.pickFiles}
        onPickPhotos={attachmentUpload.pickPhotos}
        onTakePhoto={attachmentUpload.takePhoto}
      />
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
  accent,
  canSend,
  className,
  isSending,
  muted,
  onPress,
}: {
  accent: string
  canSend: boolean
  className?: string
  isSending: boolean
  muted: string
  onPress: () => void
}) {
  return (
    <IconButton
      accessibilityLabel="Send message"
      className={className}
      feedbackVariant="scale"
      isDisabled={!canSend}
      onPress={onPress}
      variant="ghost"
    >
      {isSending ? (
        <Spinner color={accent} size="sm" />
      ) : (
        <HugeiconsIcon
          color={canSend ? accent : muted}
          icon={SentIcon}
          size={16}
        />
      )}
    </IconButton>
  )
}
