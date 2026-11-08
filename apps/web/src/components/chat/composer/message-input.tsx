import {
  Cancel01Icon,
  PlusSignIcon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { isTauri } from "@repo/auth/tauri-fetch"
import { LOR_USER_ID } from "@repo/db/constants"
import type { RealtimeHarnessCommandList } from "@repo/realtime-types/events"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import type { Node as PMNode, Schema } from "@tiptap/pm/model"
import { Selection } from "@tiptap/pm/state"
import type { EditorProps } from "@tiptap/pm/view"
import {
  type Editor,
  EditorContent,
  type EditorStateSnapshot,
  getTextSerializersFromSchema,
  isNodeEmpty,
  type JSONContent,
  type TextSerializer,
  useEditor,
  useEditorState,
} from "@tiptap/react"
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { AttachmentPreview } from "@/components/chat/composer/attachment-preview"
import { ComposerBubbleMenu } from "@/components/chat/composer/composer-bubble-menu"
import { ComposerCollapse } from "@/components/chat/composer/composer-collapse"
import {
  type ComposerHost,
  composerExtensions,
  harnessCommandItems,
} from "@/components/chat/composer/composer-extensions"
import {
  type AttachableConnector,
  ConnectorAttachMenu,
  type ConnectorRecord,
} from "@/components/chat/composer/connector-attach-menu"
import { DesktopCaret } from "@/components/chat/composer/desktop-caret"
import {
  type ComposerDestination,
  DestinationBar,
  type PingedPerson,
  type SubscriberFace,
} from "@/components/chat/composer/destination-bar"
import { LinearIssuePicker } from "@/components/chat/composer/linear-issue-picker"
import {
  LinkPopover,
  type LinkPopoverHandle,
} from "@/components/chat/composer/link-popover"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { insertRepoFileReference } from "@/components/chat/composer/repo-file-chip"
import { ContextMeter } from "@/components/chat/context-meter"
import type { ChatContext } from "@/components/chat/header"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import type { PendingAttachment } from "@/hooks/use-file-upload"
import { apiClient } from "@/lib/api-client"
import type { ConnectorKey, Message } from "@/lib/api-types"
import {
  type ComposerDraftWriter,
  composerDraftWriter,
  readComposerDraft,
} from "@/lib/composer-drafts"
import {
  extractMentionIds,
  toStoredMarkdown,
  warnIfTooLong,
  whenEditorMounted,
} from "@/lib/editor-utils"
import type { ComposerFileReference } from "@/lib/repo-file-reference"

const CONNECTORS_STALE_MS = 5 * 60 * 1000
const NO_MENTION_CANDIDATES: MentionCandidate[] = []
// Matches the scroller's edge fade (globals.css .composer-scroller).
const CARET_SCROLL_MARGIN = { top: 8, bottom: 8, left: 0, right: 0 }

interface MessageInputProps {
  // What's typed is kept under this key (with currentUserId) on this device
  // until sent, e.g. `channel:<id>`. Changing it swaps in that draft.
  draftKey?: string
  // lines: insert each line of `text` as its own plain paragraph after @Lor,
  // parsing no Markdown (Fix with Lor's untrusted review comments).
  composerDraft?: { id: string; text: string; lines?: boolean }
  onComposerDraftConsumed?: (id: string) => void
  composerFileReference?: ComposerFileReference
  onComposerFileReferenceConsumed?: (id: string) => void
  context: ChatContext
  // Enables connector attachments — omitted in DMs, which have no workspace.
  channelId?: string
  // Thread root id whose context usage the meter reports. Thread scope only:
  // channel runs always rebuild a fresh snapshot (see lor-respond.ts), so
  // context never accumulates there and a meter would imply a budget that
  // doesn't exist. Omit to hide the meter.
  contextScopeKey?: string
  // Main channel composer only: teaches @Lor through the placeholder and the
  // lor_intro hint.
  lorIntro?: boolean
  // Shows where the message goes (Lor or people) in a toolbar row under the
  // editor. Omit for DMs and call chats, which never reach Lor.
  destination?: ComposerDestination
  // Session only: the agent can't answer this person (its harness is off, or
  // Claude Code without their subscription), so every message goes to
  // people, with no switch to Lor. The server routes it the same way.
  peopleOnly?: boolean
  // Session only: the other subscribers, shown as faces when a message goes
  // to people.
  subscribers?: SubscriberFace[]
  // Shown while the message goes to Lor, after the destination pill: Claude
  // Code's mode on New session, Chat | Code for `@Lor` in chat.
  leadingTools?: ReactNode
  // Floats just above the composer, e.g. the "Started … · Open" note.
  notice?: ReactNode
  // Session document: no box; the editor is the next line of the transcript,
  // with `gutter` (the writer's avatar) beside it. The tools render into
  // `toolbarTarget`, a bar the page keeps at the bottom of the pane.
  variant?: "box" | "inline"
  gutter?: ReactNode
  toolbarTarget?: HTMLElement | null
  // Session document: typing anywhere on the page lands in this editor.
  typeToFocus?: boolean
  placeholder?: string
  disabled?: boolean
  disabledReason?: string
  onSend: (
    content: string,
    options?: {
      mentions: Message["mentions"]
      referencedMessage?: Message["referencedMessage"]
      attachments?: Message["attachments"]
      // Session only: the message is for people, so Lor does not run.
      toPeople?: boolean
      // Cmd+Enter: a send that starts a session stays where it was sent.
      stay?: boolean
    }
  ) => void
  isSending?: boolean
  // Holds the send (keeping the draft) until a choice outside the editor is
  // made, e.g. a code session's repo.
  sendBlocked?: boolean
  // The same, only while the message starts a Lor session (`@Lor` in Code
  // mode without a repo yet).
  lorSendBlocked?: boolean
  currentUserId?: string
  mentionCandidates?: MentionCandidate[]
  replyingTo?: Message | null
  onCancelReply?: () => void
  pendingAttachments: PendingAttachment[]
  addFiles: (files: File[]) => Promise<void>
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  getUploadedAttachments: () => NonNullable<Message["attachments"]>
  isUploading: boolean
  onTyping?: () => void
  onStop?: () => void
  isStopping?: boolean
  canSteerQueued?: boolean
  onSteerQueued?: () => void
  isSteeringQueued?: boolean
  // Extra controls before the send button, e.g. a Claude Code session's mode.
  tools?: ReactNode
  // Shift+Tab in the editor, like Claude Code's mode cycle.
  onShiftTab?: () => void
  // Up arrow in an empty composer: edit the person's last message here
  // (useMessageEditing). Returns false when there is none.
  onEditLast?: () => boolean
  // Session only: its harness's own commands ("/" at the start of the
  // message) and Codex's skills ("$" anywhere), sent as typed
  // (reference/skills-and-commands.md).
  harnessCommands?: RealtimeHarnessCommandList | null
}

const textSerializersBySchema = new WeakMap<
  Schema,
  Record<string, TextSerializer>
>()

function textSerializers(schema: Schema) {
  const cached = textSerializersBySchema.get(schema)
  if (cached) return cached
  const serializers = getTextSerializersFromSchema(schema)
  textSerializersBySchema.set(schema, serializers)
  return serializers
}

// Whether the draft has anything to send: `getText().trim() !== ""` without
// serializing the document. Mentions, chips and Linear cards count through
// their text serializers; the walk stops at the first visible character.
function docHasText(doc: PMNode) {
  const serializers = textSerializers(doc.type.schema)
  const range = { from: 0, to: doc.content.size }
  let found = false
  doc.descendants((node, pos, parent, index) => {
    if (found) return false
    const serializer = serializers[node.type.name]
    const text = serializer
      ? parent && serializer({ node, pos, parent, index, range })
      : node.text
    if (text?.trim()) found = true
    return !serializer && !found
  })
  return found
}

type DraftFacts = {
  isEmpty: boolean
  hasText: boolean
  isOneLine: boolean
}
const draftFactsByDoc = new WeakMap<PMNode, DraftFacts>()
const NO_EDITOR_DRAFT = {
  isEmpty: true,
  hasText: false,
  isOneLine: true,
  isFocused: false,
}

// Booleans only, so typing re-renders MessageInput when one flips (the first
// character, clearing the draft), not on every keystroke. Cached per
// document: a caret move keeps the same doc and skips the work.
function selectDraftState({ editor }: EditorStateSnapshot<Editor | null>) {
  if (!editor) return NO_EDITOR_DRAFT
  const { doc } = editor.state
  let facts = draftFactsByDoc.get(doc)
  if (!facts) {
    facts = {
      isEmpty: isNodeEmpty(doc),
      hasText: docHasText(doc),
      // The placeholder shows only on a single empty line: TipTap counts an
      // empty list or quote as empty, but its marker sits where the
      // placeholder would, and after Shift+Enter the caret is on line two.
      isOneLine:
        doc.childCount <= 1 &&
        (doc.firstChild?.type.name ?? "paragraph") === "paragraph",
    }
    draftFactsByDoc.set(doc, facts)
  }
  return { ...facts, isFocused: editor.isFocused }
}

const mentionIdsByDoc = new WeakMap<PMNode, string>()

// The draft's mention ids, space-joined so routing compares a string. Walked
// only when the document changed, not on selection-only transactions.
function selectMentionIds({ editor }: EditorStateSnapshot<Editor | null>) {
  if (!editor) return ""
  const { doc } = editor.state
  let ids = mentionIdsByDoc.get(doc)
  if (ids === undefined) {
    const found: string[] = []
    doc.descendants((node) => {
      if (node.type.name === "mention") found.push(String(node.attrs.id))
    })
    ids = found.join(" ")
    mentionIdsByDoc.set(doc, ids)
  }
  return ids
}

// Mirrors the server's session routing rule (realtime routeLor): in a session
// Lor runs unless the message addresses only people (a mention, or a reply to
// someone else) or is switched to people; addressing Lor always wins. In chat
// and human threads only an @Lor mention starts a session.
function resolveRouting({
  destination,
  mentionedIds,
  replyingTo,
  currentUserId,
  candidates,
  manualToPeople,
  peopleOnly,
}: {
  destination: ComposerDestination | undefined
  mentionedIds: string[]
  replyingTo: Message | null | undefined
  currentUserId: string | undefined
  candidates: MentionCandidate[]
  manualToPeople: boolean
  peopleOnly: boolean
}) {
  const isSession = destination === "session"
  const pinged = new Map<string, PingedPerson>()
  for (const id of mentionedIds) {
    const candidate = candidates.find((c) => c.id === id)
    if (!candidate || id === LOR_USER_ID) continue
    pinged.set(id, {
      id,
      name: candidate.name ?? candidate.label,
      image: candidate.image ?? null,
    })
  }
  const replyAuthor = replyingTo?.author
  if (
    isSession &&
    replyAuthor &&
    replyAuthor.id !== LOR_USER_ID &&
    replyAuthor.id !== currentUserId
  ) {
    pinged.set(replyAuthor.id, {
      id: replyAuthor.id,
      name: replyAuthor.name,
      image: replyAuthor.image ?? null,
    })
  }
  const addressesLor =
    mentionedIds.includes(LOR_USER_ID) ||
    (isSession && replyAuthor?.id === LOR_USER_ID)
  const toLor = isSession
    ? !peopleOnly && (addressesLor || (!manualToPeople && pinged.size === 0))
    : destination === "new" || addressesLor
  return {
    toLor,
    pinged: [...pinged.values()],
    canSwitch: isSession && !peopleOnly && !addressesLor && pinged.size === 0,
  }
}

// Programmatic content swaps (send clear, draft restore) are not undo steps:
// Cmd+Z must not bring back a sent message or another conversation's draft.
// No update event either, so no "typing" and no draft save.
function replaceContentWithoutHistory(
  editor: Editor,
  content: JSONContent | null
) {
  return editor
    .chain()
    .setMeta("addToHistory", false)
    .setContent(content ?? "", { emitUpdate: false })
}

// Another field, menu or dialog has the keyboard, so the composer must not
// take focus.
const KEYBOARD_OWNERS =
  "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"

function keyboardIsTaken() {
  const active = document.activeElement
  return active instanceof Element && active.closest(KEYBOARD_OWNERS) !== null
}

// Memoized: hosts re-render on every Lor stream frame and keep their props
// stable (useStableCallback, memoized tools), so those renders stop here.
export const MessageInput = memo(function MessageInput({
  draftKey,
  composerDraft,
  onComposerDraftConsumed,
  composerFileReference,
  onComposerFileReferenceConsumed,
  context,
  channelId,
  contextScopeKey,
  lorIntro = false,
  destination,
  peopleOnly = false,
  subscribers,
  leadingTools,
  notice,
  variant = "box",
  gutter,
  toolbarTarget,
  typeToFocus = false,
  placeholder: placeholderOverride,
  disabled,
  disabledReason,
  onSend,
  isSending,
  sendBlocked: blockedAlways = false,
  lorSendBlocked = false,
  currentUserId,
  mentionCandidates = NO_MENTION_CANDIDATES,
  replyingTo,
  onCancelReply,
  pendingAttachments,
  addFiles,
  removeAttachment,
  clearAttachments,
  getUploadedAttachments,
  isUploading,
  onTyping,
  onStop,
  isStopping = false,
  canSteerQueued = false,
  onSteerQueued,
  isSteeringQueued = false,
  tools,
  onShiftTab,
  onEditLast,
  harnessCommands,
}: MessageInputProps) {
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [attachPanel, setAttachPanel] = useState<"menu" | "linear">("menu")
  const linearSearchRef = useRef<HTMLInputElement>(null)
  // Opened from /linear, or an issue was picked: closing goes back to typing,
  // not to the + button.
  const returnFocusToEditorRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const linkPopoverRef = useRef<LinkPopoverHandle>(null)
  // Stable, so the memoized bubble menu never re-renders for it.
  const [openLinkEditor] = useState(
    () => () => linkPopoverRef.current?.open() ?? false
  )

  // DMs are user-scoped and have no workspace slug — no connectors to attach.
  // Fetched on mount (not on menu open) so the + menu is instant.
  const { workspaceSlug } = useParams({ strict: false })
  const { data: connectorsData } = useQuery({
    queryKey: ["channel-connectors", workspaceSlug, channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors.$get({
        param: {
          workspaceSlug: workspaceSlug as string,
          channelId: channelId as string,
        },
      })
      if (!res.ok) throw new Error("Failed to load channel connectors")
      return res.json()
    },
    enabled: Boolean(workspaceSlug && channelId),
    staleTime: CONNECTORS_STALE_MS,
  })
  const attachableConnectors: AttachableConnector[] =
    connectorsData?.connectors ?? []

  const composerRef = useRef<HTMLDivElement>(null)
  const lorHint = useHint("lor_intro", lorIntro && !disabled)
  const dismissLorHint = lorHint.dismiss

  const placeholder =
    placeholderOverride ??
    (context.type === "channel"
      ? lorIntro && !lorHint.dismissed
        ? `Message #${context.name}, or @Lor to start a session`
        : `Message #${context.name}`
      : `Message ${context.name}`)

  const normalizedMentionCandidates = useMemo(() => {
    const uniqueCandidates = new Map<string, MentionCandidate>()
    for (const candidate of mentionCandidates) {
      if (currentUserId && candidate.id === currentUserId) {
        continue
      }

      const label = candidate.label.trim()
      if (!label) continue
      uniqueCandidates.set(candidate.id, {
        id: candidate.id,
        label,
        search: candidate.search,
        name: candidate.name,
        image: candidate.image,
      })
    }
    return Array.from(uniqueCandidates.values())
  }, [currentUserId, mentionCandidates])

  const harnessSlashCommands = useMemo(
    () => harnessCommandItems(harnessCommands?.slash ?? [], "/"),
    [harnessCommands]
  )
  const harnessSkills = useMemo(
    () => harnessCommandItems(harnessCommands?.mentions ?? [], "$"),
    [harnessCommands]
  )
  const isInline = variant === "inline"
  // The reply bar keeps its last message while it eases shut.
  const [shownReply, setShownReply] = useState(replyingTo)
  if (replyingTo && replyingTo !== shownReply) setShownReply(replyingTo)
  // The + menu needs its button, which the inline bar renders only once its
  // target exists.
  const canOpenLinearPicker =
    attachableConnectors.some((connector) => connector.id === "linear") &&
    (!isInline || Boolean(toolbarTarget))

  const host: ComposerHost = {
    mentionCandidates: normalizedMentionCandidates,
    // A pasted `<@id>` shows the person's name.
    mentionLabel: (id) =>
      normalizedMentionCandidates.find((candidate) => candidate.id === id)
        ?.label ?? null,
    attachFiles: (files) => void addFiles(files),
    detachFile: (file) => {
      const attachment = pendingAttachments.find(
        (pending) => pending.file === file
      )
      if (!attachment) return false
      removeAttachment(attachment.id)
      return true
    },
    harnessCommands: harnessSlashCommands,
    harnessSkills,
    openLinearPicker: canOpenLinearPicker
      ? () => {
          returnFocusToEditorRef.current = true
          setAttachPanel("linear")
          setIsAttachmentMenuOpen(true)
        }
      : undefined,
    // Cmd+Enter starts a session without opening it, to fire off several.
    onSubmit: (stay) => handleSubmit(stay),
    // Escape ladder (an open menu closes first, in ComposerKeymap): cancel
    // the reply, then leave the composer. The blur leaves the key unhandled
    // so page-level Escape listeners still see it.
    onEscape: () => {
      if (replyingTo && onCancelReply) {
        onCancelReply()
        return true
      }
      editor.commands.blur()
      return false
    },
    onShiftTab: onShiftTab
      ? () => {
          onShiftTab()
          return true
        }
      : undefined,
    openLinkEditor,
    // A reply or a pending file is a draft, so Up leaves it alone.
    onEditLast: () =>
      !replyingTo && pendingAttachments.length === 0 && Boolean(onEditLast?.()),
  }
  const hostRef = useRef(host)
  hostRef.current = host
  // Built once: new extensions or editorProps would make useEditor call
  // setOptions (two ProseMirror view updates) on every render.
  const [extensions] = useState(() =>
    composerExtensions({ variant: "composer", host: hostRef })
  )
  const [editorProps] = useState(
    (): EditorProps => ({
      attributes: {
        // Prose rules shared with sent messages: globals.css .composer-prose.
        class:
          "composer-prose text-sm text-foreground/90 caret-foreground/80 outline-none",
      },
      // The caret line stays clear of the scroller's edge and its fade.
      scrollThreshold: CARET_SCROLL_MARGIN,
      scrollMargin: CARET_SCROLL_MARGIN,
    })
  )

  // Hosts key the composer by conversation, so the stored draft is the
  // editor's first document: no undo step and no placeholder flash.
  const [initialDraft] = useState(() => ({
    id: draftKey && currentUserId ? `${currentUserId}:${draftKey}` : null,
    doc:
      draftKey && currentUserId
        ? readComposerDraft(currentUserId, draftKey)
        : null,
  }))
  const shownDraftIdRef = useRef(initialDraft.id)

  const editor = useEditor(
    {
      extensions,
      editorProps,
      content: initialDraft.doc ?? "",
      // Callbacks are not compared; useEditor always calls the latest one.
      onUpdate: () => onTyping?.(),
    },
    []
  )
  useEditorEdgeFade(editor)

  const { isEmpty, hasText, isFocused, isOneLine } = useEditorState({
    editor,
    selector: selectDraftState,
  })
  const isComposing = useComposition(editor)
  const showPlaceholder = isEmpty && isOneLine && !isComposing

  const mentionedIdsKey = useEditorState({
    editor,
    selector: selectMentionIds,
  })
  const [manualToPeople, setManualToPeople] = useState(false)
  const routing = useMemo(
    () =>
      resolveRouting({
        destination,
        mentionedIds: mentionedIdsKey ? mentionedIdsKey.split(" ") : [],
        replyingTo,
        currentUserId,
        candidates: normalizedMentionCandidates,
        manualToPeople,
        peopleOnly,
      }),
    [
      destination,
      mentionedIdsKey,
      replyingTo,
      currentUserId,
      normalizedMentionCandidates,
      manualToPeople,
      peopleOnly,
    ]
  )
  const showLorState = Boolean(destination) && routing.toLor
  const sendBlocked = blockedAlways || (routing.toLor && lorSendBlocked)
  const lorPillRef = useRef<HTMLSpanElement>(null)
  // Taught once the person types in a session, when the pill decides who
  // gets the message.
  const sessionReplyHint = useHint(
    "session_reply",
    routing.canSwitch && routing.toLor && !isEmpty && !disabled
  )

  // This conversation's draft saver; a send clears it.
  const draftRef = useRef<ComposerDraftWriter | null>(null)
  // Before the composerDraft effect: a suggestion appends to a swapped-in
  // draft instead of being overwritten by it.
  useEffect(() => {
    if (!editor || !draftKey || !currentUserId) return
    const draft = composerDraftWriter(currentUserId, draftKey, () =>
      editor.isEmpty ? null : editor.getJSON()
    )
    draftRef.current = draft
    // A draftKey change without a remount swaps drafts. A user id known
    // only after mount keeps anything typed meanwhile.
    const draftId = `${currentUserId}:${draftKey}`
    if (shownDraftIdRef.current !== draftId) {
      const stored = readComposerDraft(currentUserId, draftKey)
      if (shownDraftIdRef.current !== null || (stored && editor.isEmpty)) {
        replaceContentWithoutHistory(editor, stored).run()
      }
      shownDraftIdRef.current = draftId
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") draft.flush()
    }
    editor.on("update", draft.schedule)
    editor.on("blur", draft.flush)
    window.addEventListener("pagehide", draft.flush)
    document.addEventListener("visibilitychange", flushWhenHidden)
    return () => {
      // Still this conversation's text: the next draftKey restores after.
      draft.flush()
      if (draftRef.current === draft) draftRef.current = null
      editor.off("update", draft.schedule)
      editor.off("blur", draft.flush)
      window.removeEventListener("pagehide", draft.flush)
      document.removeEventListener("visibilitychange", flushWhenHidden)
    }
  }, [editor, draftKey, currentUserId])

  const appliedDraftRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !editor ||
      !composerDraft ||
      appliedDraftRef.current === composerDraft.id
    )
      return
    const applyDraft = () => {
      if (appliedDraftRef.current === composerDraft.id) return
      appliedDraftRef.current = composerDraft.id
      // Append to an existing draft; selecting a suggestion must not erase
      // writing. A New session prompt already goes to Lor, so no @Lor.
      const { text, lines } = composerDraft
      const chain = editor.chain().focus("end")
      if (destination !== "new") {
        chain.insertContent({
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: LOR_USER_ID, label: "Lor" } },
            { type: "text", text: lines ? " " : ` ${text}` },
          ],
        })
      } else if (!lines) {
        chain.insertContent({
          type: "paragraph",
          content: [{ type: "text", text }],
        })
      }
      // Sent as escaped text, so the review's lines arrive as written.
      if (lines) {
        chain.insertContent(
          text
            .split("\n")
            .map((line) =>
              line
                ? { type: "paragraph", content: [{ type: "text", text: line }] }
                : { type: "paragraph" }
            )
        )
      }
      chain.run()
      onComposerDraftConsumed?.(composerDraft.id)
    }
    if (editor.isInitialized) applyDraft()
    editor.on("create", applyDraft)
    editor.on("mount", applyDraft)
    return () => {
      editor.off("create", applyDraft)
      editor.off("mount", applyDraft)
    }
  }, [editor, composerDraft, onComposerDraftConsumed, destination])

  const appliedFileReferenceRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editor || !composerFileReference || disabled) return
    const applyReference = () => {
      if (appliedFileReferenceRef.current === composerFileReference.id) return
      if (insertRepoFileReference(editor, composerFileReference)) {
        appliedFileReferenceRef.current = composerFileReference.id
        onComposerFileReferenceConsumed?.(composerFileReference.id)
      }
    }
    if (editor.isInitialized) applyReference()
    editor.on("create", applyReference)
    editor.on("mount", applyReference)
    return () => {
      editor.off("create", applyReference)
      editor.off("mount", applyReference)
    }
  }, [editor, composerFileReference, onComposerFileReferenceConsumed, disabled])

  const handleSend = useCallback(
    (stay = false) => {
      if (!editor) return
      // Enter otherwise does nothing here, which reads as a broken key.
      if (isUploading) {
        toast.info("Wait for the upload to finish, then send")
        return
      }

      const rawMarkdown = editor.getMarkdown()
      const markdown = toStoredMarkdown(rawMarkdown)
      const trimmed = markdown.trim()
      const uploadedAttachments = getUploadedAttachments()
      const hasAttachments = uploadedAttachments.length > 0
      const hasContent = trimmed.length > 0

      if ((!hasContent && !hasAttachments) || isSending || sendBlocked) return
      // The server would reject it; keep the draft so it can be shortened.
      if (warnIfTooLong(trimmed)) return

      const mentionCandidatesById = new Map(
        normalizedMentionCandidates.map((candidate) => [
          candidate.id,
          candidate,
        ])
      )

      const mentionIds = extractMentionIds(trimmed)
      // Asking Lor is what the lor_intro hint teaches, from any composer.
      if (mentionIds.includes(LOR_USER_ID)) dismissLorHint()

      const mentions: Message["mentions"] = mentionIds.flatMap((mentionId) => {
        const mentionCandidate = mentionCandidatesById.get(mentionId)
        if (!mentionCandidate) return []

        return [
          {
            id: mentionCandidate.id,
            name: mentionCandidate.name ?? mentionCandidate.label,
            image: mentionCandidate.image ?? null,
          },
        ]
      })

      // Taken first: onSend can navigate away and unmount this composer.
      const draft = draftRef.current
      onSend(trimmed, {
        mentions,
        referencedMessage: replyingTo
          ? {
              id: replyingTo.id,
              content: replyingTo.content,
              author: replyingTo.author,
              overrideName: replyingTo.overrideName,
              overrideAvatarUrl: replyingTo.overrideAvatarUrl,
            }
          : undefined,
        attachments: hasAttachments ? uploadedAttachments : undefined,
        toPeople: destination === "session" && !routing.toLor,
        stay,
      })
      replaceContentWithoutHistory(editor, null).focus("end").run()
      draft?.clear()
      clearAttachments()
      onCancelReply?.()
      setManualToPeople(false)
    },
    [
      editor,
      isSending,
      sendBlocked,
      isUploading,
      getUploadedAttachments,
      clearAttachments,
      normalizedMentionCandidates,
      onSend,
      replyingTo,
      onCancelReply,
      dismissLorHint,
      destination,
      routing.toLor,
    ]
  )
  const handleSubmit = useCallback(
    (stay: boolean) => {
      const hasDraft =
        docHasText(editor.state.doc) || pendingAttachments.length > 0
      if (hasDraft) {
        handleSend(stay)
        return
      }
      if (canSteerQueued && !isSteeringQueued) onSteerQueued?.()
    },
    [
      canSteerQueued,
      editor,
      handleSend,
      isSteeringQueued,
      onSteerQueued,
      pendingAttachments.length,
    ]
  )

  // Session document: a printable key pressed anywhere outside another field
  // or open dialog starts writing here, like typing into a doc. Focus moves
  // during keydown and the browser delivers the key itself, so dead keys,
  // Option characters, IME and input rules work as in the editor.
  useEffect(() => {
    if (!editor || !typeToFocus) return
    let wasFocused = editor.isFocused
    const markFocused = () => {
      wasFocused = true
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      // Option composes characters on macOS; Ctrl+Alt is AltGr on Windows.
      if (event.metaKey || event.ctrlKey) return
      const composes =
        event.key === "Dead" || event.key === "Process" || event.keyCode === 229
      // Space keeps scrolling the page.
      if (!composes && (event.key.length !== 1 || event.key === " ")) return
      const target = event.target instanceof Element ? event.target : null
      if (
        target?.closest(
          "input, textarea, select, button, [contenteditable='true'], [role='menu'], [role='listbox']"
        ) ||
        document.querySelector("[role='dialog']")
      ) {
        return
      }
      // Back where the caret was; a never-focused draft continues at its end.
      if (!wasFocused) {
        const { state } = editor
        editor.view.dispatch(
          state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView()
        )
      }
      // Synchronous: commands.focus waits a frame, after the key has landed.
      editor.view.focus()
    }
    editor.on("focus", markFocused)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      editor.off("focus", markFocused)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [editor, typeToFocus])

  // A conversation, thread or session opened: the keyboard goes to its
  // composer, on pointer devices only (a touch keyboard would cover the page).
  useEffect(() => {
    if (!editor || editor.isInitialized) return
    const autofocus = () => {
      if (!window.matchMedia("(pointer: fine)").matches) return
      if (keyboardIsTaken()) return
      editor.commands.focus("end")
    }
    editor.on("create", autofocus)
    return () => {
      editor.off("create", autofocus)
    }
  }, [editor])

  useEffect(() => {
    if (replyingTo && editor) {
      editor.commands.focus("end")
    }
  }, [replyingTo, editor])

  const canSend =
    (hasText || pendingAttachments.length > 0) &&
    !isSending &&
    !sendBlocked &&
    !isUploading
  const isStopMode =
    Boolean(onStop) && !hasText && pendingAttachments.length === 0

  const handleAttachRecord = useCallback(
    (connector: ConnectorKey, record: ConnectorRecord) => {
      if (!editor) return

      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "connectorChip",
            attrs: { connector, url: record.url, label: record.title },
          },
          { type: "text", text: " " },
        ])
        .run()
      returnFocusToEditorRef.current = true
      setIsAttachmentMenuOpen(false)
    },
    [editor]
  )

  const handleAttachLinearIssue = useCallback(
    (block: string) => {
      if (!editor) return

      editor
        .chain()
        .focus()
        .insertContent([
          { type: "linearIssue", attrs: { raw: block } },
          { type: "paragraph" },
        ])
        .run()
      returnFocusToEditorRef.current = true
      setIsAttachmentMenuOpen(false)
    },
    [editor]
  )

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (files && files.length > 0) {
        void addFiles(Array.from(files))
      }
      event.target.value = ""
    },
    [addFiles]
  )

  // Files pasted outside the editor, e.g. with focus on a toolbar button.
  // ProseMirror prevents the default of every paste it takes, and
  // ComposerPaste attaches files pasted into the editor.
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (event.defaultPrevented) return
      const files = Array.from(event.clipboardData.files)
      if (files.length > 0) {
        event.preventDefault()
        void addFiles(files)
      }
    },
    [addFiles]
  )

  // A press on the box's padding or empty space types at the end, as a
  // press under the last line does. Controls, the editor itself and
  // portaled popups (React events bubble through portals) keep theirs.
  const handleBoxMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !editor) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (!event.currentTarget.contains(target)) return
      if (editor.view.dom.parentElement?.contains(target)) return
      if (target.closest("button, a, input, textarea, select, [role]")) return
      event.preventDefault()
      editor.commands.focus("end")
    },
    [editor]
  )

  if (disabled) {
    return (
      <div className="shrink-0 px-4 pb-3">
        <div className="flex items-center justify-center rounded-lg border border-input bg-muted/40 px-3 py-3">
          <span className="text-sm text-muted-foreground">
            {disabledReason ??
              "You do not have permission to send messages in this channel"}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative shrink-0 px-4 pb-3">
      {notice}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <ComposerCollapse open={Boolean(replyingTo)}>
        {shownReply && (
          <div
            className={cn(
              "flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-sm",
              isInline
                ? "mb-1 rounded-md"
                : "rounded-t-lg border border-b-0 border-input"
            )}
          >
            <span className="truncate text-muted-foreground">
              Replying to{" "}
              <span className="font-semibold text-foreground">
                {shownReply.author.name}
              </span>
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Cancel reply"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                className="size-4"
                strokeWidth={2}
              />
            </button>
          </div>
        )}
      </ComposerCollapse>
      <HintPopover
        open={lorHint.show}
        anchor={composerRef}
        align="start"
        onDismiss={dismissLorHint}
      >
        {`Mention @Lor${isTauri ? " or press ⌘N" : ""} to start a session. Lor works there, next to the chat.`}
      </HintPopover>
      <div
        ref={composerRef}
        className={cn(
          !isInline && [
            "border bg-background transition-colors duration-150 dark:bg-muted/40",
            // New session is always Lor, so its border stays plain.
            showLorState && destination !== "new"
              ? "border-agent/50"
              : "border-input focus-within:border-muted-foreground/40",
            replyingTo ? "rounded-b-lg" : "rounded-lg",
          ]
        )}
        onPaste={handlePaste}
        onMouseDown={handleBoxMouseDown}
      >
        <AttachmentPreview
          attachments={pendingAttachments}
          onRemove={removeAttachment}
        />
        {/* With a destination the editor wraps onto its own line and the
            tools (attach, destination, send) sit on the line under it. */}
        <div
          className={cn(
            "flex items-end gap-2",
            isInline ? "px-0 pb-2" : "px-3 py-2",
            destination && !isInline && "flex-wrap items-center gap-y-1 pt-2.5"
          )}
        >
          <div
            className={cn(
              "relative min-w-0 flex-1 text-sm leading-5",
              !isInline && "[--chat-leading:21px]",
              destination && "order-first basis-full",
              // The editable fills the tall box, so a press anywhere in it
              // places the caret.
              destination === "new" && "[&_.composer-prose]:min-h-14",
              // Same column and prose size as the transcript above it.
              isInline &&
                "pl-10 [--chat-leading:24px] [&_.composer-prose]:text-[15px] [&_.composer-prose]:transition-colors",
              // Headed to the session's subscribers only: the text dims as in
              // the transcript, so the route shows without a label.
              isInline &&
                destination === "session" &&
                !routing.toLor &&
                "[&_.composer-prose]:text-muted-foreground"
            )}
          >
            {isInline && (
              <div className="absolute top-0.5 left-0">{gutter}</div>
            )}
            {showPlaceholder && placeholder && (
              <span
                className={cn(
                  "pointer-events-none absolute right-0 top-1 truncate text-sm leading-normal",
                  isInline
                    ? "left-10 text-[15px] text-muted-foreground/50 leading-6"
                    : "left-0 text-muted-foreground"
                )}
              >
                {placeholder}
              </span>
            )}
            {editor && (
              <>
                <ComposerBubbleMenu editor={editor} onLink={openLinkEditor} />
                <LinkPopover editor={editor} ref={linkPopoverRef} />
              </>
            )}
            {/* Nine whole lines plus the 4px padding at each edge, so the
                box never stops mid-line. */}
            <EditorContent
              editor={editor}
              className="composer-scroller relative max-h-[calc(var(--chat-leading)*9+8px)] overflow-y-auto overscroll-contain py-1"
            />
            <DesktopCaret editor={editor} />
          </div>
          {/* After the editor in the markup so the three tools stay together
              for the inline bar; `order-first` keeps attach on the left. */}
          <ToolsSlot
            inline={isInline}
            target={toolbarTarget ?? null}
            active={
              isFocused ||
              !isEmpty ||
              pendingAttachments.length > 0 ||
              isAttachmentMenuOpen
            }
          >
            <Popover
              open={isAttachmentMenuOpen}
              onOpenChange={(open) => {
                if (open) {
                  returnFocusToEditorRef.current = false
                  setAttachPanel("menu")
                }
                setIsAttachmentMenuOpen(open)
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="order-first size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Open attachment menu"
                  />
                }
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  className={cn(
                    "size-4 transition-transform duration-200 ease-out",
                    isAttachmentMenuOpen && "rotate-45"
                  )}
                  strokeWidth={2}
                />
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={10}
                className={attachPanel === "linear" ? "w-96" : "w-72"}
                viewportClassName="p-2"
                initialFocus={
                  attachPanel === "linear" ? linearSearchRef : undefined
                }
                finalFocus={() => {
                  if (!returnFocusToEditorRef.current) return true
                  editor?.commands.focus()
                  return false
                }}
              >
                {attachPanel === "linear" && workspaceSlug && channelId ? (
                  <LinearIssuePicker
                    workspaceSlug={workspaceSlug}
                    channelId={channelId}
                    inputRef={linearSearchRef}
                    onBack={() => setAttachPanel("menu")}
                    onPick={handleAttachLinearIssue}
                  />
                ) : (
                  <ConnectorAttachMenu
                    connectors={attachableConnectors}
                    workspaceSlug={workspaceSlug}
                    channelId={channelId}
                    onUploadFile={() => {
                      fileInputRef.current?.click()
                      setIsAttachmentMenuOpen(false)
                    }}
                    onAttach={handleAttachRecord}
                    onOpenLinear={() => setAttachPanel("linear")}
                  />
                )}
              </PopoverContent>
            </Popover>
            {destination && (
              <div className="min-w-0 flex-1">
                <DestinationBar
                  destination={destination}
                  channelName={context.name}
                  toLor={routing.toLor}
                  pinged={routing.pinged}
                  subscribers={subscribers}
                  leadingTools={leadingTools}
                  lorPillRef={lorPillRef}
                  onSwitch={
                    routing.canSwitch
                      ? () => {
                          setManualToPeople((current) => !current)
                          sessionReplyHint.dismiss()
                        }
                      : undefined
                  }
                />
                <HintPopover
                  open={sessionReplyHint.show}
                  anchor={lorPillRef}
                  align="start"
                  onDismiss={sessionReplyHint.dismiss}
                >
                  Replies go to Lor by default. Switch here to talk only to the
                  session's subscribers, without Lor answering.
                </HintPopover>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {tools}
              {/* onStop is only supplied while a run is stoppable, so it doubles
                as "Lor is working here right now". */}
              <ContextMeter
                scopeKey={contextScopeKey}
                isRunning={Boolean(onStop)}
              />
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "size-7 transition-colors",
                  isStopMode
                    ? "text-destructive hover:text-destructive"
                    : "text-muted-foreground",
                  canSend &&
                    !isStopMode &&
                    (showLorState
                      ? "bg-agent/12 text-agent hover:bg-agent/18 hover:text-agent"
                      : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")
                )}
                onClick={isStopMode ? onStop : () => handleSend()}
                disabled={isStopMode ? isStopping : !canSend}
                aria-label={
                  isStopMode
                    ? isStopping
                      ? "Stopping Lor"
                      : "Stop Lor"
                    : showLorState && destination !== "session"
                      ? "Start session"
                      : "Send message"
                }
              >
                <HugeiconsIcon
                  icon={isStopMode ? StopIcon : SentIcon}
                  size={16}
                />
              </Button>
            </div>
          </ToolsSlot>
        </div>
      </div>
    </div>
  )
})

// The composer's tools render in place, or (inline variant) in a bar the
// page owns at the bottom of the pane. Inline renders nothing until that bar
// mounts, so the tools never flash under the input line. A session reads as a
// document, so its tools stay hidden until you write (or point at the bar):
// an idle bar at the bottom looked like a missing composer.
function ToolsSlot({
  inline,
  target,
  active,
  children,
}: {
  inline: boolean
  target: HTMLElement | null
  active: boolean
  children: ReactNode
}) {
  // A menu opened from the bar (model, effort) keeps it shown: the pointer and
  // focus are in the menu's popup, outside the bar. Watched in JS, not with a
  // `:has([data-popup-open])` rule (WebKit click lag, see packages/ui).
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!bar) return
    const observer = new MutationObserver(() =>
      setMenuOpen(bar.querySelector("[data-popup-open]") !== null)
    )
    observer.observe(bar, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-popup-open"],
    })
    return () => observer.disconnect()
  }, [bar])
  if (!inline) return children
  if (!target) return null
  return createPortal(
    <div
      ref={setBar}
      className={cn(
        "flex min-w-0 items-center gap-2 transition-opacity duration-300",
        // Shows at once; lingers a moment before fading after you stop.
        active || menuOpen
          ? "opacity-100"
          : "opacity-0 delay-700 focus-within:opacity-100 focus-within:delay-0 hover:opacity-100 hover:delay-0"
      )}
    >
      {children}
    </div>,
    target
  )
}

// IME composition in progress. The first composed character can sit in the
// DOM before it reaches the document, under the placeholder. Cleared a task
// after compositionend, once ProseMirror has read the committed text, so a
// cancelled composition shows the placeholder again.
function useComposition(editor: Editor | null) {
  const [composing, setComposing] = useState(false)
  useEffect(() => {
    if (!editor) return
    return whenEditorMounted(editor, () => {
      const editable = editor.view.dom
      let timer = 0
      const start = () => {
        window.clearTimeout(timer)
        setComposing(true)
      }
      const end = () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => setComposing(false))
      }
      editable.addEventListener("compositionstart", start)
      editable.addEventListener("compositionend", end)
      return () => {
        window.clearTimeout(timer)
        editable.removeEventListener("compositionstart", start)
        editable.removeEventListener("compositionend", end)
        setComposing(false)
      }
    })
  }, [editor])
  return composing
}

// Fades the editor scroller's edge toward hidden lines only (globals.css
// .composer-scroller). Set on the DOM, so scrolling never re-renders.
function useEditorEdgeFade(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return
    return whenEditorMounted(editor, () => {
      const editable = editor.view.dom
      const scroller = editable.parentElement
      if (!scroller) return () => {}
      const update = () => {
        const { scrollTop, scrollHeight, clientHeight } = scroller
        scroller.toggleAttribute("data-fade-top", scrollTop > 0.5)
        scroller.toggleAttribute(
          "data-fade-bottom",
          scrollHeight - clientHeight - scrollTop > 0.5
        )
      }
      const observer = new ResizeObserver(update)
      observer.observe(scroller)
      observer.observe(editable)
      scroller.addEventListener("scroll", update, { passive: true })
      update()
      return () => {
        observer.disconnect()
        scroller.removeEventListener("scroll", update)
        scroller.removeAttribute("data-fade-top")
        scroller.removeAttribute("data-fade-bottom")
      }
    })
  }, [editor])
}
