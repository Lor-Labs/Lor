import {
  ArrowUp02Icon,
  Cancel01Icon,
  PlusSignIcon,
  SentIcon,
  SourceCodeIcon,
  StopIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { isTauri } from "@repo/auth/tauri-fetch"
import { LOR_USER_ID } from "@repo/db/constants"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import Link from "@tiptap/extension-link"
import Mention, { type MentionOptions } from "@tiptap/extension-mention"
import { Markdown } from "@tiptap/markdown"
import { PluginKey } from "@tiptap/pm/state"
import {
  EditorContent,
  Extension,
  ReactRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion"
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { AttachmentPreview } from "@/components/chat/composer/attachment-preview"
import { CodeBlockShiki } from "@/components/chat/composer/code-block-shiki"
import {
  type AttachableConnector,
  ConnectorAttachMenu,
  type ConnectorRecord,
} from "@/components/chat/composer/connector-attach-menu"
import { ConnectorChip } from "@/components/chat/composer/connector-chip"
import { DesktopCaret } from "@/components/chat/composer/desktop-caret"
import {
  type ComposerDestination,
  DestinationBar,
  type PingedPerson,
} from "@/components/chat/composer/destination-bar"
import {
  MentionSuggestionList,
  type MentionSuggestionListProps,
  type MentionSuggestionListRef,
} from "@/components/chat/composer/mention-suggestion-list"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import {
  type SlashCommandItem,
  SlashCommandList,
  type SlashCommandListProps,
  type SlashCommandListRef,
} from "@/components/chat/composer/slash-command-list"
import { ContextMeter } from "@/components/chat/context-meter"
import type { ChatContext } from "@/components/chat/header"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import type { PendingAttachment } from "@/hooks/use-file-upload"
import { apiClient } from "@/lib/api-client"
import type { ConnectorKey, Message } from "@/lib/api-types"
import {
  extractMentionIds,
  toStoredMarkdown,
  whenEditorMounted,
} from "@/lib/editor-utils"

const MAX_MENTION_RESULTS = 8
const MAX_SLASH_RESULTS = 8
const CONNECTORS_STALE_MS = 5 * 60 * 1000
// Pastes longer than this become a .txt attachment instead of inline text,
// matching ChatGPT/Claude/Discord. Keeps the editor responsive and stays well
// under MESSAGE_CONTENT_MAX_LENGTH.
const LARGE_PASTE_CHAR_THRESHOLD = 4000
const LARGE_PASTE_FILENAME = "pasted-text.txt"
const POPUP_HORIZONTAL_PADDING = 8
const POPUP_VERTICAL_PADDING = 8
const POPUP_GAP = 6
export const SUGGESTION_MENU_SELECTOR =
  "[data-suggestion-open='true'], [data-mention-suggestion-open='true'], [data-slash-suggestion-open='true'], [data-slash-command-open='true']"
const SLASH_COMMAND_PLUGIN_KEY = new PluginKey("slash-command")
const DEFAULT_CODE_BLOCK_LANGUAGE = "plaintext"
const CODE_BLOCK_LANGUAGE_OPTIONS = [
  { value: "plaintext", label: "Plain Text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
] as const
const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: "code-block",
    label: "Code Block",
    description: "Insert a code block",
    search: "code snippet block fence",
  },
]

interface MessageInputProps {
  composerDraft?: { id: string; text: string }
  onComposerDraftConsumed?: (id: string) => void
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
  // New session only: chooses the session's channel, in the destination bar.
  channelPicker?: ReactNode
  // Floats just above the composer, e.g. the "Started … · Open" note.
  notice?: ReactNode
  // Session document: no box; the editor is the next line of the transcript,
  // with `gutter` (the writer's avatar) beside it. The tools render into
  // `toolbarTarget`, a bar the page keeps at the bottom of the pane.
  variant?: "box" | "inline"
  gutter?: ReactNode
  toolbarTarget?: HTMLElement | null
  // Session document: typing anywhere on the page lands in this editor; called
  // after it takes focus (to scroll the input line into view).
  onTypeToFocus?: () => void
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
}

interface SuggestionPopupListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface SuggestionPopupManagerOptions<
  TItem,
  TListProps extends { items: TItem[]; command: (item: TItem) => void },
> {
  rendererComponent: ComponentType<TListProps>
  popupClassName: string
  popupDataAttribute: string
  popupFallbackWidth: number
  popupFallbackHeight: number
}

function createSuggestionPopupManager<
  TItem,
  TListRef extends SuggestionPopupListRef,
  TListProps extends { items: TItem[]; command: (item: TItem) => void },
>({
  rendererComponent,
  popupClassName,
  popupDataAttribute,
  popupFallbackWidth,
  popupFallbackHeight,
}: SuggestionPopupManagerOptions<TItem, TListProps>) {
  let popup: HTMLDivElement | null = null
  let currentProps: SuggestionProps<TItem, TItem> | null = null
  let reactRenderer: ReactRenderer<TListRef, TListProps> | null = null
  // Reposition when the rendered list changes height — onUpdate fires before
  // React commits, so measuring there sees the previous list's height and
  // strands a shrunken popup floating above the caret.
  let resizeObserver: ResizeObserver | null = null

  const positionPopup = () => {
    const clientRect = currentProps?.clientRect?.()
    if (!popup || !clientRect) return

    const popupWidth = popup.offsetWidth || popupFallbackWidth
    const popupHeight = popup.offsetHeight || popupFallbackHeight
    const maxLeft = Math.max(
      POPUP_HORIZONTAL_PADDING,
      window.innerWidth - popupWidth - POPUP_HORIZONTAL_PADDING
    )
    const left = Math.min(
      Math.max(POPUP_HORIZONTAL_PADDING, clientRect.left),
      maxLeft
    )
    const top = Math.max(
      POPUP_VERTICAL_PADDING,
      clientRect.top - popupHeight - POPUP_GAP
    )

    popup.style.left = `${left}px`
    popup.style.top = `${top}px`
  }

  const cleanup = () => {
    window.removeEventListener("resize", positionPopup)
    window.removeEventListener("scroll", positionPopup, true)
    resizeObserver?.disconnect()
    resizeObserver = null
    reactRenderer?.destroy()
    reactRenderer = null
    popup?.remove()
    popup = null
    currentProps = null
  }

  return {
    onStart: (props: SuggestionProps<TItem, TItem>) => {
      cleanup()
      currentProps = props

      popup = document.createElement("div")
      popup.className = popupClassName
      popup.dataset[popupDataAttribute] = "true"
      popup.dataset.suggestionOpen = "true"
      document.body.append(popup)

      reactRenderer = new ReactRenderer(rendererComponent, {
        editor: props.editor,
        props: {
          items: props.items,
          command: props.command,
        } as TListProps,
      })

      popup.append(reactRenderer.element)
      window.addEventListener("resize", positionPopup)
      window.addEventListener("scroll", positionPopup, true)
      resizeObserver = new ResizeObserver(() => positionPopup())
      resizeObserver.observe(popup)
      positionPopup()
    },
    onUpdate: (props: SuggestionProps<TItem, TItem>) => {
      currentProps = props
      reactRenderer?.updateProps({
        items: props.items,
        command: props.command,
      } as TListProps)
      positionPopup()
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === "Escape") {
        props.event.preventDefault()
        cleanup()
        return true
      }

      const suggestionList = reactRenderer?.ref as TListRef | null
      return suggestionList?.onKeyDown(props) ?? false
    },
    onExit: cleanup,
  }
}

export function createMentionSuggestion(
  getMentionCandidates: () => MentionCandidate[]
): MentionOptions<MentionCandidate>["suggestion"] {
  return {
    char: "@",
    items: ({ query }) => {
      const normalized = query.trim().toLowerCase()
      const results = getMentionCandidates().filter((candidate) => {
        if (!normalized) return true
        return (
          candidate.label.toLowerCase().includes(normalized) ||
          candidate.search?.toLowerCase().includes(normalized)
        )
      })
      return results.slice(0, MAX_MENTION_RESULTS)
    },
    render: () => {
      return createSuggestionPopupManager<
        MentionCandidate,
        MentionSuggestionListRef,
        MentionSuggestionListProps
      >({
        rendererComponent: MentionSuggestionList,
        popupClassName:
          "fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        popupDataAttribute: "mentionSuggestionOpen",
        popupFallbackWidth: 288,
        popupFallbackHeight: 240,
      })
    },
  }
}

function createSlashCommandSuggestion(): Omit<
  SuggestionOptions<SlashCommandItem, SlashCommandItem>,
  "editor"
> {
  return {
    pluginKey: SLASH_COMMAND_PLUGIN_KEY,
    char: "/",
    items: ({ query }) => {
      const normalized = query.trim().toLowerCase()
      const results = SLASH_COMMANDS.filter((command) => {
        if (!normalized) return true
        return (
          command.label.toLowerCase().includes(normalized) ||
          command.search?.toLowerCase().includes(normalized)
        )
      })
      return results.slice(0, MAX_SLASH_RESULTS)
    },
    command: ({ editor, range, props }) => {
      if (props.id !== "code-block") {
        return
      }

      editor
        .chain()
        .focus()
        .insertContentAt(range, {
          type: "codeBlock",
          attrs: { language: DEFAULT_CODE_BLOCK_LANGUAGE },
        })
        .run()
    },
    allow: ({ editor }) => {
      if (!editor.isEditable) return false
      return !editor.isActive("codeBlock")
    },
    render: () => {
      return createSuggestionPopupManager<
        SlashCommandItem,
        SlashCommandListRef,
        SlashCommandListProps
      >({
        rendererComponent: SlashCommandList,
        popupClassName:
          "fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        popupDataAttribute: "slashSuggestionOpen",
        popupFallbackWidth: 288,
        popupFallbackHeight: 240,
      })
    },
  }
}

function createSlashCommandExtension(
  suggestion: Omit<
    SuggestionOptions<SlashCommandItem, SlashCommandItem>,
    "editor"
  >
) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...suggestion,
        }),
      ]
    },
  })
}

function getCodeBlockLanguageValue(language: unknown) {
  if (typeof language !== "string") {
    return DEFAULT_CODE_BLOCK_LANGUAGE
  }

  const normalized = language.trim().toLowerCase()
  if (!normalized) {
    return DEFAULT_CODE_BLOCK_LANGUAGE
  }

  const supported = CODE_BLOCK_LANGUAGE_OPTIONS.some(
    (option) => option.value === normalized
  )

  if (supported) {
    return normalized
  }

  return DEFAULT_CODE_BLOCK_LANGUAGE
}

function _getActiveCodeBlockRect(editor: {
  state: {
    doc: {
      nodeAt: (pos: number) => { attrs?: { language?: unknown } } | null
    }
    selection: {
      $from: {
        depth: number
        node: (depth: number) => { type: { name: string } }
        before: (depth: number) => number
      }
    }
  }
  view: {
    nodeDOM: (pos: number) => Node | null
  }
}) {
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== "codeBlock") continue

    const domNode = editor.view.nodeDOM($from.before(depth))
    if (!(domNode instanceof HTMLElement)) continue

    const rect = domNode.getBoundingClientRect()
    return new DOMRect(rect.left + 8, rect.top + 8, 1, 1)
  }

  return null
}

function getActiveCodeBlockPos(editor: {
  state: {
    selection: {
      $from: {
        depth: number
        node: (depth: number) => { type: { name: string } }
        before: (depth: number) => number
      }
    }
  }
}) {
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "codeBlock") {
      return $from.before(depth)
    }
  }

  return null
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
}: {
  destination: ComposerDestination | undefined
  mentionedIds: string[]
  replyingTo: Message | null | undefined
  currentUserId: string | undefined
  candidates: MentionCandidate[]
  manualToPeople: boolean
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
    ? addressesLor || (!manualToPeople && pinged.size === 0)
    : destination === "new" || addressesLor
  return {
    toLor,
    pinged: [...pinged.values()],
    canSwitch: isSession && !addressesLor && pinged.size === 0,
  }
}

export function MessageInput({
  composerDraft,
  onComposerDraftConsumed,
  context,
  channelId,
  contextScopeKey,
  lorIntro = false,
  destination,
  channelPicker,
  notice,
  variant = "box",
  gutter,
  toolbarTarget,
  onTypeToFocus,
  placeholder: placeholderOverride,
  disabled,
  disabledReason,
  onSend,
  isSending,
  currentUserId,
  mentionCandidates = [],
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
}: MessageInputProps) {
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const mentionCandidatesRef = useRef<MentionCandidate[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleSubmitRef = useRef<(stay: boolean) => void>(() => undefined)
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  const onTypingRef = useRef(onTyping)
  onTypingRef.current = onTyping

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

  useEffect(() => {
    mentionCandidatesRef.current = normalizedMentionCandidates
  }, [normalizedMentionCandidates])

  const mentionSuggestion = useMemo(
    () => createMentionSuggestion(() => mentionCandidatesRef.current),
    []
  )
  const slashCommandSuggestion = useMemo(
    () => createSlashCommandSuggestion(),
    []
  )
  const slashCommandExtension = useMemo(
    () => createSlashCommandExtension(slashCommandSuggestion),
    [slashCommandSuggestion]
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          horizontalRule: false,
          codeBlock: false,
          // Registered separately below with app-specific options.
          link: false,
        }),
        CodeBlockShiki.configure({
          defaultLanguage: "plaintext",
        }),
        Markdown,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            class:
              "text-primary underline-offset-2 hover:underline cursor-pointer",
            rel: "noreferrer noopener",
            target: "_blank",
          },
        }),
        Mention.configure({
          HTMLAttributes: {
            class: "rounded bg-primary/15 px-1 py-0.5 font-medium text-primary",
          },
          renderText: ({ options, node }) =>
            `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`,
          suggestion: mentionSuggestion,
        }),
        ConnectorChip,
        slashCommandExtension,
      ],
      editorProps: {
        attributes: {
          class:
            "min-h-5 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90 caret-foreground/80 outline-none [&_p]:m-0 [&_p]:leading-5 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-border/70 [&_code]:bg-primary/10 [&_code]:px-0.75 [&_code]:py-0.25 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-foreground [&_pre]:mt-1 [&_pre]:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-muted/50 [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:text-[0.92em] [&_pre]:leading-6 [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground",
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Enter" || event.shiftKey) return false
          if (event.isComposing) return false
          if (document.querySelector(SUGGESTION_MENU_SELECTOR)) return false

          event.preventDefault()
          event.stopPropagation()
          // Cmd+Enter starts a session without opening it, to fire off several.
          handleSubmitRef.current(event.metaKey || event.ctrlKey)
          return true
        },
        handlePaste: (_view, event) => {
          // File pastes are handled by the wrapper's onPaste via addFiles.
          if (event.clipboardData?.files.length) return false

          const text = event.clipboardData?.getData("text/plain")
          if (!text || text.length <= LARGE_PASTE_CHAR_THRESHOLD) return false

          event.preventDefault()
          void addFilesRef.current([
            new File([text], LARGE_PASTE_FILENAME, { type: "text/plain" }),
          ])
          return true
        },
      },
      onUpdate: () => {
        onTypingRef.current?.()
      },
    },
    []
  )

  const draftState = useEditorState({
    editor,
    selector: ({ editor: tiptapEditor }) => ({
      text: tiptapEditor?.getText({ blockSeparator: "\n" }) ?? "",
      isEmpty: tiptapEditor?.isEmpty ?? true,
      isFocused: tiptapEditor?.isFocused ?? false,
    }),
  })
  const plainText = draftState?.text ?? ""
  const isEmpty = draftState?.isEmpty ?? true
  const isFocused = draftState?.isFocused ?? false

  const mentionedIdsKey = useEditorState({
    editor,
    selector: ({ editor: tiptapEditor }) => {
      const ids: string[] = []
      tiptapEditor?.state.doc.descendants((node) => {
        if (node.type.name === "mention") ids.push(String(node.attrs.id))
      })
      return ids.join(" ")
    },
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
      }),
    [
      destination,
      mentionedIdsKey,
      replyingTo,
      currentUserId,
      normalizedMentionCandidates,
      manualToPeople,
    ]
  )
  const showLorState = Boolean(destination) && routing.toLor
  const isInline = variant === "inline"
  const destinationRef = useRef<HTMLDivElement>(null)
  // Taught once the person types in a session, when the pill decides who
  // gets the message.
  const sessionReplyHint = useHint(
    "session_reply",
    routing.canSwitch && !isEmpty && !disabled
  )

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
      editor
        .chain()
        .focus("end")
        .insertContent({
          type: "paragraph",
          content:
            destination === "new"
              ? [{ type: "text", text: composerDraft.text }]
              : [
                  {
                    type: "mention",
                    attrs: {
                      id: LOR_USER_ID,
                      label: "Lor",
                    },
                  },
                  { type: "text", text: ` ${composerDraft.text}` },
                ],
        })
        .run()
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

  const handleSend = useCallback(
    (stay = false) => {
      if (!editor || isUploading) return

      const rawMarkdown = editor.getMarkdown()
      const markdown = toStoredMarkdown(rawMarkdown)
      const trimmed = markdown.trim()
      const uploadedAttachments = getUploadedAttachments()
      const hasAttachments = uploadedAttachments.length > 0
      const hasContent = trimmed.length > 0

      if ((!hasContent && !hasAttachments) || isSending) return

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
      editor.commands.clearContent(true)
      editor.commands.focus("end")
      clearAttachments()
      onCancelReply?.()
      setManualToPeople(false)
    },
    [
      editor,
      isSending,
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
        plainText.trim().length > 0 || pendingAttachments.length > 0
      if (hasDraft) {
        handleSend(stay)
        return
      }
      if (canSteerQueued && !isSteeringQueued) onSteerQueued?.()
    },
    [
      canSteerQueued,
      handleSend,
      isSteeringQueued,
      onSteerQueued,
      pendingAttachments.length,
      plainText,
    ]
  )
  handleSubmitRef.current = handleSubmit

  // Session document: a printable key pressed anywhere outside another field
  // or open dialog starts writing here, like typing into a doc.
  const onTypeToFocusRef = useRef(onTypeToFocus)
  onTypeToFocusRef.current = onTypeToFocus
  const typeToFocus = Boolean(onTypeToFocus)
  useEffect(() => {
    if (!editor || !typeToFocus) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length !== 1) return
      const target = event.target instanceof Element ? event.target : null
      if (
        target?.closest(
          "input, textarea, select, button, [contenteditable='true'], [role='menu'], [role='listbox']"
        ) ||
        document.querySelector("[role='dialog']")
      ) {
        return
      }
      event.preventDefault()
      editor.chain().focus("end").insertContent(event.key).run()
      onTypeToFocusRef.current?.()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [editor, typeToFocus])

  useEffect(() => {
    if (replyingTo && editor) {
      editor.commands.focus("end")
    }
  }, [replyingTo, editor])

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault()
        event.stopPropagation()
        editor.chain().focus().toggleBold().run()
        return
      }
    }

    return whenEditorMounted(editor, () => {
      const domNode = editor.view.dom
      domNode.addEventListener("keydown", handleKeyDown, { capture: true })
      return () => {
        domNode.removeEventListener("keydown", handleKeyDown, {
          capture: true,
        })
      }
    })
  }, [editor])

  const trimmedValue = plainText.trim()
  const canSend =
    (trimmedValue.length > 0 || pendingAttachments.length > 0) &&
    !isSending &&
    !isUploading
  const isStopMode =
    Boolean(onStop) &&
    trimmedValue.length === 0 &&
    pendingAttachments.length === 0
  const markState = useEditorState({
    editor,
    selector: ({ editor: tiptapEditor }) => {
      if (!tiptapEditor) {
        return {
          isBoldActive: false,
          isCodeBlockActive: false,
          codeBlockPos: null,
          isCodeActive: false,
          codeBlockLanguage: DEFAULT_CODE_BLOCK_LANGUAGE,
          isItalicActive: false,
          isStrikeActive: false,
        }
      }

      return {
        isBoldActive: tiptapEditor.isActive("bold"),
        isCodeBlockActive: tiptapEditor.isActive("codeBlock"),
        codeBlockPos: getActiveCodeBlockPos(tiptapEditor),
        isCodeActive: tiptapEditor.isActive("code"),
        codeBlockLanguage: getCodeBlockLanguageValue(
          tiptapEditor.getAttributes("codeBlock").language
        ),
        isItalicActive: tiptapEditor.isActive("italic"),
        isStrikeActive: tiptapEditor.isActive("strike"),
      }
    },
  })
  const isBoldActive = markState?.isBoldActive ?? false
  const _isCodeBlockActive = markState?.isCodeBlockActive ?? false
  const codeBlockPos = markState?.codeBlockPos ?? null
  const isCodeActive = markState?.isCodeActive ?? false
  const _codeBlockLanguage =
    markState?.codeBlockLanguage ?? DEFAULT_CODE_BLOCK_LANGUAGE
  const isItalicActive = markState?.isItalicActive ?? false
  const isStrikeActive = markState?.isStrikeActive ?? false

  const getMarkButtonClassName = (isActive: boolean) =>
    cn(
      "size-7 border border-transparent text-muted-foreground",
      "hover:text-foreground",
      isActive &&
        "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
    )

  const _handleCodeBlockLanguageChange = useCallback(
    (language: string) => {
      if (!editor || codeBlockPos === null) return

      const codeBlockNode = editor.state.doc.nodeAt(codeBlockPos)
      if (!codeBlockNode || codeBlockNode.type.name !== "codeBlock") return

      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(codeBlockPos, undefined, {
          ...codeBlockNode.attrs,
          language,
        })
      )
      editor.commands.focus()
    },
    [codeBlockPos, editor]
  )

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

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData.files)
      if (files.length > 0) {
        event.preventDefault()
        void addFiles(files)
      }
    },
    [addFiles]
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
      {replyingTo && (
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
              {replyingTo.author.name}
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
              "relative min-w-0 flex-1 py-1 text-sm leading-5",
              destination && "order-first basis-full",
              destination === "new" && "min-h-16",
              // Same column and prose size as the transcript above it.
              isInline &&
                "pl-10 [&_.tiptap]:text-[15px] [&_.tiptap]:leading-6 [&_.tiptap]:transition-colors [&_.tiptap_p]:leading-6",
              // Headed to channel members only: the text dims as it will in
              // the transcript, so the route shows without a label.
              isInline &&
                destination === "session" &&
                !routing.toLor &&
                "[&_.tiptap]:text-muted-foreground"
            )}
          >
            {isInline && (
              <div className="absolute top-0.5 left-0">{gutter}</div>
            )}
            {isEmpty && placeholder && (
              <span
                className={cn(
                  "pointer-events-none absolute right-0 top-1 truncate text-sm leading-5",
                  isInline
                    ? "left-10 text-[15px] text-muted-foreground/50 leading-6"
                    : "left-0 text-muted-foreground"
                )}
              >
                {placeholder}
              </span>
            )}
            {editor && (
              <BubbleMenu
                editor={editor}
                appendTo={() => document.body}
                shouldShow={({ editor: tiptapEditor, state, from, to }) => {
                  if (!tiptapEditor.isEditable) return false
                  if (state.selection.empty || from === to) return false
                  if (tiptapEditor.isActive("codeBlock")) return false
                  return state.doc.textBetween(from, to).trim().length > 0
                }}
                getReferencedVirtualElement={() => {
                  const { selection } = editor.state
                  if (selection.empty) return null

                  const { left, right, top, bottom } = editor.view.coordsAtPos(
                    selection.head
                  )

                  return {
                    getBoundingClientRect: () =>
                      new DOMRect(
                        left,
                        top,
                        Math.max(1, right - left),
                        Math.max(1, bottom - top)
                      ),
                  }
                }}
                options={{
                  strategy: "fixed",
                  placement: "top",
                  offset: 8,
                  flip: true,
                  shift: true,
                }}
                className="z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className={getMarkButtonClassName(isBoldActive)}
                  aria-label="Bold"
                  aria-pressed={isBoldActive}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    editor.chain().focus().toggleBold().run()
                  }}
                  disabled={!editor.can().chain().focus().toggleBold().run()}
                >
                  <HugeiconsIcon
                    icon={TextBoldIcon}
                    className="size-3.5"
                    strokeWidth={isBoldActive ? 2.5 : 2}
                  />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className={getMarkButtonClassName(isItalicActive)}
                  aria-label="Italic"
                  aria-pressed={isItalicActive}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    editor.chain().focus().toggleItalic().run()
                  }}
                  disabled={!editor.can().chain().focus().toggleItalic().run()}
                >
                  <HugeiconsIcon
                    icon={TextItalicIcon}
                    className="size-3.5"
                    strokeWidth={isItalicActive ? 2.5 : 2}
                  />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className={getMarkButtonClassName(isCodeActive)}
                  aria-label="Inline code"
                  aria-pressed={isCodeActive}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    editor.chain().focus().toggleCode().run()
                  }}
                  disabled={!editor.can().chain().focus().toggleCode().run()}
                >
                  <HugeiconsIcon
                    icon={SourceCodeIcon}
                    className="size-3.5"
                    strokeWidth={isCodeActive ? 2.5 : 2}
                  />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className={getMarkButtonClassName(isStrikeActive)}
                  aria-label="Strikethrough"
                  aria-pressed={isStrikeActive}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    editor.chain().focus().toggleStrike().run()
                  }}
                  disabled={!editor.can().chain().focus().toggleStrike().run()}
                >
                  <HugeiconsIcon
                    icon={TextStrikethroughIcon}
                    className="size-3.5"
                    strokeWidth={isStrikeActive ? 2.5 : 2}
                  />
                </Button>
              </BubbleMenu>
            )}
            <EditorContent
              editor={editor}
              className="relative max-h-[200px] overflow-y-auto overscroll-contain"
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
              onOpenChange={setIsAttachmentMenuOpen}
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
                className="w-72"
                viewportClassName="p-2"
              >
                <ConnectorAttachMenu
                  connectors={attachableConnectors}
                  workspaceSlug={workspaceSlug}
                  channelId={channelId}
                  onUploadFile={() => {
                    fileInputRef.current?.click()
                    setIsAttachmentMenuOpen(false)
                  }}
                  onAttach={handleAttachRecord}
                />
              </PopoverContent>
            </Popover>
            {destination && (
              <div ref={destinationRef} className="min-w-0 flex-1">
                <DestinationBar
                  destination={destination}
                  channelName={context.name}
                  toLor={routing.toLor}
                  pinged={routing.pinged}
                  channelPicker={channelPicker}
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
                  anchor={destinationRef}
                  align="start"
                  onDismiss={sessionReplyHint.dismiss}
                >
                  Replies go to Lor by default. Switch here to talk to channel
                  members without Lor answering.
                </HintPopover>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
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
                      : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"),
                  // New session: a filled round button, like an agent prompt.
                  destination === "new" &&
                    cn(
                      "rounded-full",
                      canSend &&
                        "bg-agent text-agent-foreground hover:bg-agent/90 hover:text-agent-foreground"
                    )
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
                  icon={
                    isStopMode
                      ? StopIcon
                      : destination === "new"
                        ? ArrowUp02Icon
                        : SentIcon
                  }
                  size={16}
                />
              </Button>
            </div>
          </ToolsSlot>
        </div>
      </div>
    </div>
  )
}

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
  if (!inline) return children
  if (!target) return null
  return createPortal(
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 transition-opacity duration-300",
        // Shows at once; lingers a moment before fading after you stop.
        active
          ? "opacity-100"
          : "opacity-0 delay-700 focus-within:opacity-100 focus-within:delay-0 hover:opacity-100 hover:delay-0"
      )}
    >
      {children}
    </div>,
    target
  )
}
