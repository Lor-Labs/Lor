import type { RealtimeHarnessCommandList } from "@repo/realtime-types/events"
import type { MentionOptions } from "@tiptap/extension-mention"
import { Selection } from "@tiptap/extensions"
import type { Node as PMNode } from "@tiptap/pm/model"
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state"
import {
  Extension,
  type Extensions,
  type JSONContent,
  type Range,
  ReactRenderer,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion"
import type { ComponentType, RefObject } from "react"
import { CodeBlockShiki } from "@/components/chat/composer/code-block-shiki"
import {
  ComposerKeymap,
  SUGGESTION_PRIORITY,
} from "@/components/chat/composer/composer-keymap"
import { ComposerMarkdown } from "@/components/chat/composer/composer-markdown"
import {
  ComposerPaste,
  isParsingPastedMarkdown,
} from "@/components/chat/composer/composer-paste"
import { ConnectorChip } from "@/components/chat/composer/connector-chip"
import { LinearIssue } from "@/components/chat/composer/linear-issue-node"
import {
  ComposerLink,
  ComposerMention,
} from "@/components/chat/composer/mention-markdown"
import {
  MentionSuggestionList,
  type MentionSuggestionListProps,
  rankMentionCandidates,
} from "@/components/chat/composer/mention-suggestion-list"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { RepoFileChip } from "@/components/chat/composer/repo-file-chip"
import {
  type SlashCommandItem,
  SlashCommandList,
  type SlashCommandListProps,
} from "@/components/chat/composer/slash-command-list"
import type { SuggestionListRef } from "@/components/chat/composer/use-suggestion-list"

const MAX_MENTION_RESULTS = 8
const MAX_SLASH_RESULTS = 8
const POPUP_HORIZONTAL_PADDING = 8
const POPUP_VERTICAL_PADDING = 8
const POPUP_GAP = 6
const MENTION_PLUGIN_KEY = new PluginKey("mention")
const SLASH_COMMAND_PLUGIN_KEY = new PluginKey("slash-command")
const SKILL_MENTION_PLUGIN_KEY = new PluginKey("skill-mention")
// Every suggestion menu a composer can open (ComposerKeymap suggestionKeys).
const COMPOSER_SUGGESTION_KEYS = [
  MENTION_PLUGIN_KEY,
  SLASH_COMMAND_PLUGIN_KEY,
  SKILL_MENTION_PLUGIN_KEY,
]
// Also right after an opening paren or quote: (@Lor, "@Lor.
const MENTION_PREFIXES = [" ", " ", "(", '"', "'", "“", "‘"]
const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: "code-block",
    label: "Code Block",
    description: "Insert a code block",
    search: "code snippet block fence",
  },
]
// Offered only where Linear is attachable; opens the + menu's issue picker.
const LINEAR_SLASH_COMMAND: SlashCommandItem = {
  id: "linear-issue",
  label: "Linear Issue",
  description: "Find a Linear issue and add it",
  search: "linear issue ticket",
}

// What a chat editor reads from the component hosting it. Read on every use,
// so hosts update it each render while the extension list is built once per
// editor and `editor.setOptions()` never runs on a re-render.
export interface ComposerHost {
  mentionCandidates: MentionCandidate[]
  // Name for a stored `<@id>` loaded back into the editor.
  mentionLabel?: (id: string) => string | null
  // Enter sends; Cmd/Ctrl+Enter sends with `stay`.
  onSubmit: (stay: boolean) => void
  // Escape with no menu open. Returns whether it did anything.
  onEscape: () => boolean
  // Shift+Tab outside lists and code blocks.
  onShiftTab?: () => boolean
  // Composer only: the session harness's "/" commands and Codex's "$" skills.
  harnessCommands?: SlashCommandItem[]
  harnessSkills?: SlashCommandItem[]
  // Set where Linear is attachable; adds Linear Issue to the "/" menu.
  openLinearPicker?: () => void
  // Composer only: pasted files, and long pastes as a .txt, become
  // attachments (composer-paste.ts).
  attachFiles?: (files: File[]) => void
  // Removes a pasted file still waiting to be sent; false once it is gone.
  detachFile?: (file: File) => boolean
  // Cmd+K / Cmd+Shift+U: opens the link popover; false if it can't open.
  openLinkEditor?: () => boolean
  // Composer only: Up arrow in an empty composer edits the person's last
  // message. False when there is none to edit.
  onEditLast?: () => boolean
}

// Stored messages can hold block markdown these editors have no node for. A
// heading would load as an unknown node, which empties the whole document,
// and a rule or table would be dropped, so each loads as plain text: "# "
// before the heading, "---", the table's lines. Like any literal text, it is
// escaped on save (composer-markdown.ts), so it stays text. A pasted heading
// becomes a bold line instead (composer-paste.ts).
const BLOCK_MARKDOWN_AS_TEXT = [
  Extension.create({
    name: "headingAsText",
    markdownTokenName: "heading",
    parseMarkdown: (token, helpers) => {
      const content = helpers.parseInline(token.tokens ?? [])
      return helpers.createNode(
        "paragraph",
        undefined,
        isParsingPastedMarkdown()
          ? content.map(boldText)
          : [
              helpers.createTextNode(`${"#".repeat(token.depth ?? 1)} `),
              ...content,
            ]
      )
    },
  }),
  Extension.create({
    name: "ruleAsText",
    markdownTokenName: "hr",
    parseMarkdown: (_token, helpers) =>
      helpers.createNode("paragraph", undefined, [
        helpers.createTextNode("---"),
      ]),
  }),
  Extension.create({
    name: "tableAsText",
    markdownTokenName: "table",
    parseMarkdown: (token, helpers) =>
      helpers.createNode(
        "paragraph",
        undefined,
        (token.raw ?? "")
          .replace(/\n+$/, "")
          .split("\n")
          .flatMap((line, index): JSONContent[] => [
            ...(index > 0 ? [{ type: "hardBreak" }] : []),
            ...(line ? [helpers.createTextNode(line)] : []),
          ])
      ),
  }),
]

// Inline code excludes other marks, so it stays as it is.
function boldText(node: JSONContent): JSONContent {
  const marks = node.marks ?? []
  if (
    node.type !== "text" ||
    marks.some((mark) => mark.type === "bold" || mark.type === "code")
  ) {
    return node
  }
  return { ...node, marks: [...marks, { type: "bold" }] }
}

const CHAT_STARTER_KIT = StarterKit.configure({
  heading: false,
  horizontalRule: false,
  codeBlock: false,
  // Registered separately with app-specific options.
  link: false,
  // Messages don't render underline.
  underline: false,
  // A list, code block or Linear card at the end would add an empty line
  // under it. Arrow Down leaves a code block, the gap cursor a card.
  trailingNode: false,
  // No spellcheck in inline code, as in code blocks (code-block-view.tsx).
  code: { HTMLAttributes: { spellcheck: "false" } },
})

// Spellcheck stays on for prose. Autocorrect and smart substitutions would
// rewrite commands, paths and code, and inline writing suggestions (Safari
// 18+) fight the editor. Autocapitalize acts on touch keyboards only, where
// a chat message starts a sentence.
const CHAT_INPUT_ATTRIBUTES = Extension.create({
  name: "chatInputAttributes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          attributes: {
            spellcheck: "true",
            autocorrect: "off",
            autocapitalize: "sentences",
            writingsuggestions: "false",
          },
        },
      }),
    ]
  },
})

const CHAT_CODE_BLOCK = CodeBlockShiki.configure({
  enableTabIndentation: true,
  tabSize: 2,
  // Up at the top of a leading block would add a line above it.
  exitOnArrowUp: false,
})

const CHAT_LINK = ComposerLink.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  // Typed or pasted `[text](url)` becomes a link.
  markdownLinks: true,
  defaultProtocol: "https",
  HTMLAttributes: {
    // As sent links look: message-markdown.tsx `a` plus Typography's underline.
    class:
      "cursor-pointer font-medium text-primary underline underline-offset-2",
    rel: "noreferrer noopener",
    target: "_blank",
  },
})

// Paints a selection while the editor is blurred, so the text being linked
// stays marked while the link popover's input has focus.
const CHAT_SELECTION = Selection.configure({ className: "composer-selection" })

// The chat editors' extensions: the message composer, and the message edit
// box, which has no "/" or "$" menus. Build once per editor.
export function composerExtensions({
  variant,
  host,
}: {
  variant: "composer" | "edit"
  host: RefObject<ComposerHost>
}): Extensions {
  return [
    CHAT_STARTER_KIT,
    CHAT_CODE_BLOCK,
    ComposerMarkdown,
    ...BLOCK_MARKDOWN_AS_TEXT,
    CHAT_LINK,
    CHAT_SELECTION,
    CHAT_INPUT_ATTRIBUTES,
    ComposerMention.configure({
      HTMLAttributes: {
        class:
          "rounded-[3px] bg-mention px-0.5 font-medium text-primary box-decoration-clone",
      },
      renderText: ({ options, node }) =>
        `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`,
      // Backspace removes the whole mention instead of reopening the menu.
      deleteTriggerWithBackspace: true,
      suggestion: createMentionSuggestion(() => host.current.mentionCandidates),
      mentionLabel: (id) => host.current.mentionLabel?.(id) ?? null,
    }),
    ConnectorChip,
    LinearIssue,
    RepoFileChip,
    ComposerPaste.configure({
      attachFiles: (files) => {
        const attachFiles = host.current.attachFiles
        if (!attachFiles) return false
        attachFiles(files)
        return true
      },
      detachFile: (file) => host.current.detachFile?.(file) ?? false,
    }),
    ...(variant === "composer" ? commandMenus(host) : []),
    ComposerKeymap.configure({
      suggestionKeys: COMPOSER_SUGGESTION_KEYS,
      onSubmit: (stay) => host.current.onSubmit(stay),
      onEscape: () => host.current.onEscape(),
      onShiftTab: () => host.current.onShiftTab?.() ?? false,
      onLink: () => host.current.openLinkEditor?.() ?? false,
      onEditLast: () => host.current.onEditLast?.() ?? false,
    }),
  ]
}

function commandMenus(host: RefObject<ComposerHost>): Extensions {
  return [
    createSlashCommandExtension(
      createSlashCommandSuggestion(
        () =>
          host.current.openLinearPicker
            ? [...SLASH_COMMANDS, LINEAR_SLASH_COMMAND]
            : SLASH_COMMANDS,
        () => host.current.harnessCommands ?? [],
        () => host.current.openLinearPicker?.()
      )
    ),
    createSlashCommandExtension(
      createSkillMentionSuggestion(() => host.current.harnessSkills ?? []),
      "skillMention"
    ),
  ]
}

interface SuggestionPopupManagerOptions<
  TItem,
  TListProps extends { items: TItem[]; command: (item: TItem) => void },
> {
  rendererComponent: ComponentType<TListProps>
  popupClassName: string
  popupFallbackWidth: number
  popupFallbackHeight: number
}

function createSuggestionPopupManager<
  TItem,
  TListRef extends SuggestionListRef,
  TListProps extends { items: TItem[]; command: (item: TItem) => void },
>({
  rendererComponent,
  popupClassName,
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

  // Items arrive after onStart (props.loading), so the popup opens with its
  // first results instead of flashing empty, and keeps the old ones while
  // the next arrive. `shouldShow` keeps a query with no results inactive.
  const render = (props: SuggestionProps<TItem, TItem>) => {
    if (props.loading) return
    currentProps = props
    const listProps = {
      items: props.items,
      command: props.command,
    } as TListProps
    if (reactRenderer) {
      reactRenderer.updateProps(listProps)
      positionPopup()
      return
    }

    popup = document.createElement("div")
    popup.className = popupClassName
    // Pressing anywhere in the menu keeps focus, and the menu, in the editor.
    popup.addEventListener("mousedown", (event) => event.preventDefault())
    document.body.append(popup)

    reactRenderer = new ReactRenderer(rendererComponent, {
      editor: props.editor,
      props: listProps,
    })

    popup.append(reactRenderer.element)
    window.addEventListener("resize", positionPopup)
    window.addEventListener("scroll", positionPopup, true)
    resizeObserver = new ResizeObserver(() => positionPopup())
    resizeObserver.observe(popup)
    positionPopup()
  }

  return {
    onStart: (props: SuggestionProps<TItem, TItem>) => {
      cleanup()
      render(props)
    },
    onUpdate: render,
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

// Suggestion menus never open inside inline code or a code block.
function isInCode(state: EditorState, { from, to }: Range) {
  const code = state.schema.marks.code
  return Boolean(
    state.doc.resolve(from).parent.type.spec.code ||
      (code && state.doc.rangeHasMark(from, to, code))
  )
}

function createMentionSuggestion(
  getMentionCandidates: () => MentionCandidate[]
): MentionOptions<MentionCandidate>["suggestion"] {
  const results = (query: string) =>
    rankMentionCandidates(getMentionCandidates(), query, MAX_MENTION_RESULTS)
  return {
    pluginKey: MENTION_PLUGIN_KEY,
    char: "@",
    allowedPrefixes: MENTION_PREFIXES,
    // Mention's own check (the node fits here), plus no menu in code.
    allow: ({ state, range }) => {
      const mention = state.schema.nodes.mention
      return (
        Boolean(
          mention &&
            state.doc
              .resolve(range.from)
              .parent.type.contentMatch.matchType(mention)
        ) && !isInCode(state, range)
      )
    },
    // A query with no results opens nothing, so Enter still sends.
    shouldShow: ({ query }) => results(query).length > 0,
    items: ({ query }) => results(query),
    render: () => {
      return createSuggestionPopupManager<
        MentionCandidate,
        SuggestionListRef,
        MentionSuggestionListProps
      >({
        rendererComponent: MentionSuggestionList,
        popupClassName:
          "fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        popupFallbackWidth: 288,
        popupFallbackHeight: 240,
      })
    },
  }
}

function matchesQuery(command: SlashCommandItem, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    command.label.toLowerCase().includes(normalized) ||
    Boolean(command.search?.toLowerCase().includes(normalized))
  )
}

export function harnessCommandItems(
  commands: RealtimeHarnessCommandList["slash"],
  sigil: "/" | "$"
): SlashCommandItem[] {
  return commands.map((command) => ({
    id: `${sigil === "$" || command.name.startsWith("skill:") ? "skill" : "harness"}:${command.name}`,
    label: `${sigil}${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`,
    description: command.description,
    search: command.name,
    insert: `${sigil}${command.name} `,
  }))
}

function createSlashCommandSuggestion(
  getCommands: () => SlashCommandItem[],
  getHarnessCommands: () => SlashCommandItem[],
  onLinearIssue: () => void
): Omit<SuggestionOptions<SlashCommandItem, SlashCommandItem>, "editor"> {
  const results = (doc: PMNode, slashAt: number, query: string) => {
    // The harness takes its commands only as the message's first word. A
    // leaf placeholder so a mention or chip before the slash counts. A list
    // item or quote sends a marker ("- ", "> ") before it, so it never counts.
    const $slash = doc.resolve(slashAt)
    const afterMarker = Array.from({ length: $slash.depth + 1 }, (_, depth) =>
      $slash.node(depth)
    ).some(
      (node) => node.type.name === "listItem" || node.type.name === "blockquote"
    )
    const atStart =
      !afterMarker && !doc.textBetween(0, slashAt, "\n", "￼").trim()
    return [...(atStart ? getHarnessCommands() : []), ...getCommands()]
      .filter((command) => matchesQuery(command, query))
      .slice(0, MAX_SLASH_RESULTS)
  }
  return {
    pluginKey: SLASH_COMMAND_PLUGIN_KEY,
    char: "/",
    allow: ({ state, range }) => !isInCode(state, range),
    // "check /tmp" opens nothing, so Enter still sends.
    shouldShow: ({ transaction, range, query }) =>
      results(transaction.doc, range.from, query).length > 0,
    items: ({ query, editor }) => {
      const slashAt: number | undefined = SLASH_COMMAND_PLUGIN_KEY.getState(
        editor.state
      )?.range.from
      return slashAt === undefined
        ? []
        : results(editor.state.doc, slashAt, query)
    },
    command: ({ editor, range, props }) => {
      if (props.insert) {
        editor.chain().focus().insertContentAt(range, props.insert).run()
        return
      }
      if (props.id === "linear-issue") {
        editor.chain().focus().deleteRange(range).run()
        onLinearIssue()
        return
      }
      if (props.id !== "code-block") {
        return
      }

      editor.chain().focus().insertContentAt(range, { type: "codeBlock" }).run()
    },
    render: () => {
      return createSuggestionPopupManager<
        SlashCommandItem,
        SuggestionListRef,
        SlashCommandListProps
      >({
        rendererComponent: SlashCommandList,
        popupClassName:
          "fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        popupFallbackWidth: 288,
        popupFallbackHeight: 240,
      })
    },
  }
}

// Codex's skills, mentioned as "$name" anywhere in the message.
function createSkillMentionSuggestion(
  getSkills: () => SlashCommandItem[]
): Omit<SuggestionOptions<SlashCommandItem, SlashCommandItem>, "editor"> {
  const results = (query: string) =>
    getSkills()
      .filter((skill) => matchesQuery(skill, query))
      .slice(0, MAX_SLASH_RESULTS)
  return {
    pluginKey: SKILL_MENTION_PLUGIN_KEY,
    char: "$",
    allow: ({ state, range }) => !isInCode(state, range),
    shouldShow: ({ query }) => results(query).length > 0,
    items: ({ query }) => results(query),
    command: ({ editor, range, props }) => {
      if (props.insert) {
        editor.chain().focus().insertContentAt(range, props.insert).run()
      }
    },
    render: () =>
      createSuggestionPopupManager<
        SlashCommandItem,
        SuggestionListRef,
        SlashCommandListProps
      >({
        rendererComponent: SlashCommandList,
        popupClassName:
          "fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        popupFallbackWidth: 288,
        popupFallbackHeight: 240,
      }),
  }
}

function createSlashCommandExtension(
  suggestion: Omit<
    SuggestionOptions<SlashCommandItem, SlashCommandItem>,
    "editor"
  >,
  name = "slashCommand"
) {
  return Extension.create({
    name,
    // The menu takes Enter before the composer keymap sends.
    priority: SUGGESTION_PRIORITY,
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
