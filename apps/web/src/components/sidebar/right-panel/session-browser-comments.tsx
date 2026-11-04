import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useEffect, useRef, useState } from "react"
import type { SessionBrowserLive } from "@/components/sidebar/right-panel/session-browser-live-view"
import { useSocket } from "@/context/socket-context"
import { uploadAttachment } from "@/hooks/use-file-upload"
import { apiClient } from "@/lib/api-client"

// Element comments (reference/planned/sandbox-browser-runbook.md §5): the
// person in control picks elements with Chromium's own picker, writes a note
// for each, and sends them to Lor as one message: each element's role, name,
// selector, page and HTML snippet, with a cropped screenshot of each attached
// in order. Sending hands control back so Lor can make and check the fix.

type PickedElement = {
  selector: string
  tag: string
  role: string | null
  name: string | null
  text: string
  html: string
  url: string
}

type BrowserComment = {
  id: string
  index: number
  element: PickedElement
  image: string | null
  note: string
}

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return body?.message ?? fallback
}

const shortUrl = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "")

// `button "Sign in"`, else `<div>` with the start of its text.
function elementLabel(element: PickedElement) {
  if (element.role && element.name) return `${element.role} "${element.name}"`
  const text = element.text.slice(0, 40)
  return text ? `<${element.tag}> "${text}"` : `<${element.tag}>`
}

function commentsMessage(comments: BrowserComment[], withImages: boolean) {
  const page = comments[0]?.element.url ?? ""
  const lines = [`Comments on ${shortUrl(page)} in the session browser:`]
  comments.forEach((comment, i) => {
    const { element } = comment
    const where = element.url === page ? "" : ` on ${shortUrl(element.url)}`
    lines.push(
      "",
      `**${i + 1}. ${elementLabel(element)}**: ${comment.note.trim() || "(no note)"}`,
      `\`${element.selector}\`${where}`,
      "```html",
      // A fence inside the snippet would end the code block early.
      element.html.replaceAll("```", "` ` `"),
      "```"
    )
  })
  if (withImages) {
    lines.push("", "A screenshot of each element is attached, in order.")
  }
  return lines.join("\n")
}

function jpegFile(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new File([bytes], name, { type: "image/jpeg" })
}

export function useSessionBrowserComments(
  sessionId: string,
  channelId: string,
  threadRootId: string,
  live: SessionBrowserLive
) {
  const socket = useSocket()
  const [comments, setComments] = useState<BrowserComment[]>([])
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const pickingRef = useRef(false)
  const nextIndex = useRef(1)

  const call = async (
    json: { mode: "pick"; index: number } | { mode: "cancel" | "clear" }
  ) => {
    const res = await apiClient.v1.sessions[":sessionId"].browser.pick.$post({
      param: { sessionId },
      json,
    })
    if (!res.ok) throw new Error(await errorMessage(res, "Couldn't comment"))
    return res.json()
  }

  // One pick per click on Comment / Add element; a pick that times out
  // (about 50 s) asks again while picking is still on.
  const pick = async () => {
    if (pickingRef.current) return
    pickingRef.current = true
    setPicking(true)
    try {
      if (!live.youControl) await live.takeControlAsync()
      while (pickingRef.current) {
        const index = nextIndex.current
        const result = await call({ mode: "pick", index })
        if (!pickingRef.current) break
        if (result.status === "picked") {
          nextIndex.current += 1
          setComments((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              index,
              element: result.element,
              image: result.image,
              note: "",
            },
          ])
          break
        }
        if (result.status === "no_page") {
          toast.error("Open a page in the browser first")
          break
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't comment")
    } finally {
      pickingRef.current = false
      setPicking(false)
    }
  }

  const stopPicking = () => {
    if (!pickingRef.current) return
    pickingRef.current = false
    setPicking(false)
    void call({ mode: "cancel" }).catch(() => {})
  }

  const reset = () => {
    pickingRef.current = false
    setPicking(false)
    setComments([])
    nextIndex.current = 1
    void call({ mode: "clear" }).catch(() => {})
  }

  const send = async () => {
    if (comments.length === 0 || sending) return
    if (!socket?.connected) {
      toast.error("Connection lost. Try again")
      return
    }
    setSending(true)
    try {
      const uploads = await Promise.all(
        comments.map((comment, i) =>
          comment.image
            ? uploadAttachment(
                channelId,
                jpegFile(comment.image, `element-${i + 1}.jpg`)
              )
            : Promise.resolve(null)
        )
      )
      const attachments = uploads.filter((upload) => upload !== null)
      const result = await socket.timeout(15_000).emitWithAck("message:send", {
        channelId,
        threadRootId,
        content: commentsMessage(comments, attachments.length > 0),
        attachments,
        nonce: crypto.randomUUID(),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      reset()
      // Lor needs the browser to make and check the fix.
      if (live.youControl) live.handBack()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send")
    } finally {
      setSending(false)
    }
  }

  // Leaving the panel stops a pick still waiting in the sandbox.
  useEffect(
    () => () => {
      if (pickingRef.current) {
        pickingRef.current = false
        void call({ mode: "cancel" }).catch(() => {})
      }
    },
    []
  )

  return {
    comments,
    picking,
    sending,
    pick: () => void pick(),
    stopPicking,
    discard: reset,
    send: () => void send(),
    setNote: (id: string, note: string) =>
      setComments((current) =>
        current.map((comment) =>
          comment.id === id ? { ...comment, note } : comment
        )
      ),
    remove: (id: string) =>
      setComments((current) => current.filter((comment) => comment.id !== id)),
  }
}

export type SessionBrowserComments = ReturnType<
  typeof useSessionBrowserComments
>

// The picked elements with a note each, above the footer while commenting.
export function SessionBrowserCommentsCard({
  comments,
}: {
  comments: SessionBrowserComments
}) {
  const lastNote = useRef<HTMLInputElement>(null)
  const count = comments.comments.length
  // A new pick moves the cursor to its note.
  useEffect(() => {
    if (count > 0) lastNote.current?.focus()
  }, [count])
  if (count === 0 && !comments.picking) return null
  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-border/70 bg-card">
      {comments.comments.length > 0 && (
        <ol className="max-h-56 divide-y divide-border/60 overflow-y-auto">
          {comments.comments.map((comment, i) => (
            <li key={comment.id} className="flex gap-2.5 px-3 py-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-[11px] text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className="truncate text-xs"
                  title={comment.element.selector}
                >
                  <span className="font-medium">
                    {elementLabel(comment.element)}
                  </span>
                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                    {comment.element.selector}
                  </span>
                </p>
                <input
                  aria-label={`Note for element ${i + 1}`}
                  value={comment.note}
                  ref={
                    i === comments.comments.length - 1 ? lastNote : undefined
                  }
                  placeholder="What should change?"
                  onChange={(event) =>
                    comments.setNote(comment.id, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    )
                      comments.send()
                  }}
                  className="h-7 w-full rounded-md border border-border/70 bg-background px-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                />
              </div>
              <button
                type="button"
                title="Remove"
                aria-label={`Remove element ${i + 1}`}
                onClick={() => comments.remove(comment.id)}
                className="mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="size-3"
                  strokeWidth={2}
                />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center gap-2 border-border/60 border-t bg-muted/30 px-3 py-2 first:border-t-0">
        {comments.picking ? (
          <>
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
              strokeWidth={2}
            />
            <p className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
              Click an element on the page
            </p>
            <Button size="xs" variant="ghost" onClick={comments.stopPicking}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="xs" variant="outline" onClick={comments.pick}>
              Add element
            </Button>
            <span className="flex-1" />
            <Button size="xs" variant="ghost" onClick={comments.discard}>
              Discard
            </Button>
            <Button
              size="xs"
              disabled={comments.sending}
              onClick={comments.send}
            >
              {comments.sending ? "Sending…" : "Send to Lor"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
