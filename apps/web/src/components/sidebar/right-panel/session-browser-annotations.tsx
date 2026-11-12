import { toast } from "@repo/ui/components/toast"
import { useEffect, useRef, useState } from "react"
import type {
  BrowserCommentExport,
  SessionBrowserLive,
} from "@/components/sidebar/right-panel/session-browser-live-view"
import { useSocket } from "@/context/socket-context"
import { uploadAttachment } from "@/hooks/use-file-upload"
import { apiClient } from "@/lib/api-client"

// Page annotations (reference/planned/sandbox-browser-runbook.md §5 and §7):
// notes pinned to elements or highlighted text, drawn on the page itself so
// everyone watching and Lor see them. Send to Lor posts one message (each
// element's role, name, selector, page, HTML snippet and note, with a cropped
// screenshot of each attached in order) and clears the pins.
// Shared (the collab gateway): anyone annotates without control, everyone
// sees notes as they are typed, and one Send takes all of them.
// Before it: the person in control picks elements with Chromium's own picker,
// picking starts again after each note until Done, and Send hands control
// back so Lor can make and check the fix.

type AnnotatedElement = {
  selector: string
  tag: string
  role: string | null
  name: string | null
  text: string
  html: string
  url: string
}

type Annotation = {
  id: string
  number: number
  element: AnnotatedElement
  image: string | null
  note: string
}

type AnnotateRequest =
  | { mode: "pick"; id: string; number: number }
  | { mode: "wait"; id: string }
  | { mode: "stop" | "clear" }

export type AnnotatePhase = "off" | "starting" | "picking" | "writing"

export type SessionBrowserAnnotations = {
  // Everyone's notes, made without control.
  shared: boolean
  count: number
  // This person's, which Discard removes.
  mine: number
  phase: AnnotatePhase
  sending: boolean
  start: () => void
  done: () => void
  discard: () => void
  // Null outside the app: a preview link's page never sends to Lor.
  send: (() => void) | null
}

// Drafts outlive the panel (switching sessions or tabs): their pins stay on
// the sandbox page until sent or discarded.
const drafts = new Map<string, Annotation[]>()

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return body?.message ?? fallback
}

async function annotateRequest(sessionId: string, json: AnnotateRequest) {
  const res = await apiClient.v1.sessions[":sessionId"].browser.annotate.$post({
    param: { sessionId },
    json,
  })
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Couldn't annotate the page"))
  }
  return res.json()
}

// The page's notes win; one missing from the page (it reloaded) keeps the
// last note the panel heard.
function reconcile(
  annotations: Annotation[],
  notes: { id: string; note: string | null }[]
) {
  return annotations.flatMap((annotation) => {
    const found = notes.find((entry) => entry.id === annotation.id)
    if (!found) return [annotation]
    return found.note === null ? [] : [{ ...annotation, note: found.note }]
  })
}

const shortUrl = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "")

// `button "Sign in"`, else `<div>` with the start of its text.
function elementLabel(element: AnnotatedElement) {
  if (element.role && element.name) return `${element.role} "${element.name}"`
  const text = element.text.slice(0, 40)
  return text ? `<${element.tag}> "${text}"` : `<${element.tag}>`
}

type SentAnnotation = {
  element: AnnotatedElement
  note: string
  // Named when several people annotated.
  author?: string
  quote?: string | null
}

function annotationsMessage(
  annotations: SentAnnotation[],
  withImages: boolean
) {
  const page = annotations[0]?.element.url ?? ""
  const lines = [`Annotations on ${shortUrl(page)} in the session browser:`]
  annotations.forEach((annotation, i) => {
    const { element } = annotation
    const where = element.url === page ? "" : ` on ${shortUrl(element.url)}`
    const by = annotation.author ? ` (${annotation.author})` : ""
    lines.push(
      "",
      `**${i + 1}. ${elementLabel(element)}**${by}: ${annotation.note.trim() || "(no note)"}`,
      ...(annotation.quote
        ? [`On the text: "${annotation.quote.replace(/\s+/g, " ")}"`]
        : []),
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

// How long Send waits for the gateway to say the sent notes are gone.
const CLEAR_WAIT_MS = 5_000

function jpegFile(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new File([bytes], name, { type: "image/jpeg" })
}

export function useSessionBrowserAnnotations(
  sessionId: string,
  channelId: string,
  threadRootId: string,
  live: SessionBrowserLive
): SessionBrowserAnnotations {
  const socket = useSocket()
  const [annotations, setAnnotations] = useState<Annotation[]>(
    () => drafts.get(sessionId) ?? []
  )
  const [phase, setPhaseState] = useState<AnnotatePhase>("off")
  const [sending, setSending] = useState(false)
  const list = useRef(annotations)
  const phaseRef = useRef<AnnotatePhase>("off")
  const liveRef = useRef(live)
  liveRef.current = live
  // Bumped by every start, Done, Send and Discard: an older loop drops its
  // results (its sandbox run was replaced and fails).
  const run = useRef(0)
  const tookControl = useRef(false)

  const setPhase = (next: AnnotatePhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }

  const update = (change: (current: Annotation[]) => Annotation[]) => {
    list.current = change(list.current)
    if (list.current.length > 0) drafts.set(sessionId, list.current)
    else drafts.delete(sessionId)
    setAnnotations(list.current)
  }

  // Pins number from 1 again once none are left.
  const nextNumber = () =>
    Math.max(0, ...list.current.map((annotation) => annotation.number)) + 1

  // Pick, then wait for that note, until Done, Send or Discard.
  const start = async () => {
    const mine = ++run.current
    const stale = () => run.current !== mine
    setPhase("starting")
    try {
      if (!liveRef.current.youControl) {
        await liveRef.current.takeControlAsync()
        tookControl.current = true
      }
      while (!stale()) {
        setPhase("picking")
        const id = crypto.randomUUID()
        const number = nextNumber()
        const picked = await annotateRequest(sessionId, {
          mode: "pick",
          id,
          number,
        })
        // Kept even after Done: the pin is already on the page.
        if (picked.status === "picked") {
          update((current) => [
            ...current,
            {
              id,
              number,
              element: picked.element,
              image: picked.image,
              note: "",
            },
          ])
        }
        if (stale()) return
        if (picked.status === "no_page") {
          toast.error("Open a page in the browser first")
          break
        }
        const writing =
          picked.status === "picked"
            ? id
            : picked.status === "reopened"
              ? picked.id
              : null
        if (!writing) continue
        setPhase("writing")
        for (;;) {
          const result = await annotateRequest(sessionId, {
            mode: "wait",
            id: writing,
          })
          if (stale()) return
          if (result.status === "timeout") continue
          if (result.status === "saved") {
            update((current) =>
              current.map((annotation) =>
                annotation.id === writing
                  ? { ...annotation, note: result.note }
                  : annotation
              )
            )
          } else {
            update((current) =>
              current.filter((annotation) => annotation.id !== writing)
            )
          }
          break
        }
      }
    } catch (err) {
      if (stale()) return
      toast.error(
        err instanceof Error ? err.message : "Couldn't annotate the page"
      )
    }
    if (!stale()) void done()
  }

  // Done: stops picking; a note still open on the page is kept as written.
  const done = async () => {
    run.current += 1
    setPhase("off")
    try {
      const result = await annotateRequest(sessionId, { mode: "stop" })
      if (result.status === "stopped") {
        update((current) => reconcile(current, result.notes))
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't annotate the page"
      )
    }
  }

  const discard = () => {
    run.current += 1
    setPhase("off")
    update(() => [])
    void annotateRequest(sessionId, { mode: "clear" }).catch(() => {})
    if (tookControl.current && liveRef.current.youControl) {
      liveRef.current.handBack()
    }
    tookControl.current = false
  }

  const send = async () => {
    if (sending) return
    if (!socket?.connected) {
      toast.error("Connection lost. Try again")
      return
    }
    run.current += 1
    setPhase("off")
    setSending(true)
    try {
      const stopped = await annotateRequest(sessionId, { mode: "stop" }).catch(
        () => null
      )
      if (stopped?.status === "stopped") {
        update((current) => reconcile(current, stopped.notes))
      }
      const annotations = list.current
      if (annotations.length === 0) return
      const uploads = await Promise.all(
        annotations.map((annotation, i) =>
          annotation.image
            ? uploadAttachment(
                channelId,
                jpegFile(annotation.image, `element-${i + 1}.jpg`)
              )
            : Promise.resolve(null)
        )
      )
      const attachments = uploads.filter((upload) => upload !== null)
      const result = await socket.timeout(15_000).emitWithAck("message:send", {
        channelId,
        threadRootId,
        content: annotationsMessage(annotations, attachments.length > 0),
        attachments,
        nonce: crypto.randomUUID(),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      update(() => [])
      void annotateRequest(sessionId, { mode: "clear" }).catch(() => {})
      tookControl.current = false
      // Lor needs the browser to make and check the fix.
      if (liveRef.current.youControl) liveRef.current.handBack()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send")
    } finally {
      setSending(false)
    }
  }

  // Lor's idle hand-back waits while there are annotations.
  const holding = phase !== "off" || annotations.length > 0
  useEffect(() => {
    live.hold(holding)
  }, [holding, live.hold])

  // Another session's drafts; leaving one stops its picking and keeps its pins.
  useEffect(() => {
    list.current = drafts.get(sessionId) ?? []
    setAnnotations(list.current)
    return () => {
      if (phaseRef.current === "off") return
      run.current += 1
      setPhase("off")
      void annotateRequest(sessionId, { mode: "stop" })
        .then((result) => {
          if (result.status !== "stopped") return
          const kept = reconcile(drafts.get(sessionId) ?? [], result.notes)
          if (kept.length > 0) drafts.set(sessionId, kept)
          else drafts.delete(sessionId)
        })
        .catch(() => {})
    }
  }, [sessionId])

  return {
    shared: false,
    count: annotations.length,
    mine: annotations.length,
    phase,
    sending,
    start: () => void start(),
    done: () => void done(),
    discard,
    send: () => void send(),
  }
}

// With the collab gateway the notes live in the sandbox and the page's bridge
// script does the picking and the note box, so this only switches the mode
// and sends.
export function useSessionBrowserSharedAnnotations(
  channelId: string,
  threadRootId: string,
  live: SessionBrowserLive,
  { canSend = true }: { canSend?: boolean } = {}
): SessionBrowserAnnotations {
  const socket = useSocket()
  const [sending, setSending] = useState(false)
  const { comments, annotating, myId } = live
  // The gateway's latest list, read during a send that outlives this render.
  const latest = useRef(comments)
  latest.current = comments

  // The gateway broadcasts its list after it wrote it to the browser's
  // folder, so a list without these ids means they are gone and stored.
  const cleared = (ids: string[]) =>
    new Promise<boolean>((resolve) => {
      const start = Date.now()
      const check = () => {
        if (!latest.current.some((comment) => ids.includes(comment.id))) {
          resolve(true)
        } else if (Date.now() - start > CLEAR_WAIT_MS) {
          resolve(false)
        } else {
          setTimeout(check, 150)
        }
      }
      check()
    })

  const send = async () => {
    if (sending) return
    if (!socket?.connected) {
      toast.error("Connection lost. Try again")
      return
    }
    setSending(true)
    try {
      // Saves this person's open note first.
      live.post({ type: "annotate", on: false })
      const exported = await live.exportComments()
      // A note someone else is still writing stays on the page.
      const items = exported
        .filter((item) => !item.open)
        .sort((a, b) => a.number - b.number)
      if (items.length === 0) return
      const several = new Set(items.map((item) => item.by.userId)).size > 1
      const uploads = await Promise.all(
        items.map((item: BrowserCommentExport, i) =>
          item.image
            ? uploadAttachment(
                channelId,
                jpegFile(item.image, `element-${i + 1}.jpg`)
              )
            : Promise.resolve(null)
        )
      )
      // A note discarded while the screenshots uploaded doesn't go.
      const present = new Set(latest.current.map((comment) => comment.id))
      const kept = items.flatMap((item, i) =>
        present.has(item.id) ? [{ item, upload: uploads[i] ?? null }] : []
      )
      if (kept.length === 0) return
      const sent = kept.map((entry) => entry.item)
      const attachments = kept.flatMap((entry) =>
        entry.upload ? [entry.upload] : []
      )
      const result = await socket.timeout(15_000).emitWithAck("message:send", {
        channelId,
        threadRootId,
        content: annotationsMessage(
          sent.map((item) => ({
            element: item.element,
            note: item.note,
            quote: item.element.quote,
            author:
              several || item.by.userId !== myId ? item.by.name : undefined,
          })),
          attachments.length > 0
        ),
        attachments,
        nonce: crypto.randomUUID(),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const ids = sent.map((item) => item.id)
      if (live.post({ type: "clear", ids }) && (await cleared(ids))) {
        live.store()
      } else {
        toast.error(
          "Sent to Lor, but the notes are still on the page. Don't send them again"
        )
      }
      // Lor needs the browser to make and check the fix.
      if (live.youControl) live.handBack()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send")
    } finally {
      setSending(false)
    }
  }

  return {
    shared: true,
    count: comments.length,
    mine: comments.filter((comment) => comment.by.userId === myId).length,
    phase: annotating.on ? (annotating.writing ? "writing" : "picking") : "off",
    sending,
    start: () => live.post({ type: "annotate", on: true }),
    done: () => live.post({ type: "annotate", on: false }),
    discard: () => {
      live.post({ type: "annotate", on: false })
      live.post({ type: "clear" })
    },
    send: canSend ? () => void send() : null,
  }
}
