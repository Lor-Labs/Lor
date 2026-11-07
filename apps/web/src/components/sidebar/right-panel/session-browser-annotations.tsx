import { toast } from "@repo/ui/components/toast"
import { useEffect, useRef, useState } from "react"
import type { SessionBrowserLive } from "@/components/sidebar/right-panel/session-browser-live-view"
import { useSocket } from "@/context/socket-context"
import { uploadAttachment } from "@/hooks/use-file-upload"
import { apiClient } from "@/lib/api-client"

// Page annotations (reference/planned/sandbox-browser-runbook.md §5): the
// person in control clicks elements with Chromium's own picker, and each gets
// a numbered pin and a note box drawn on the page itself, so everyone watching
// and Lor see them. Picking starts again after each note until Done. Send to
// Lor posts one message (each element's role, name, selector, page, HTML
// snippet and note, with a cropped screenshot of each attached in order),
// clears the pins and hands control back so Lor can make and check the fix.

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

function annotationsMessage(annotations: Annotation[], withImages: boolean) {
  const page = annotations[0]?.element.url ?? ""
  const lines = [`Annotations on ${shortUrl(page)} in the session browser:`]
  annotations.forEach((annotation, i) => {
    const { element } = annotation
    const where = element.url === page ? "" : ` on ${shortUrl(element.url)}`
    lines.push(
      "",
      `**${i + 1}. ${elementLabel(element)}**: ${annotation.note.trim() || "(no note)"}`,
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

export function useSessionBrowserAnnotations(
  sessionId: string,
  channelId: string,
  threadRootId: string,
  live: SessionBrowserLive
) {
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
    annotations,
    phase,
    sending,
    start: () => void start(),
    done: () => void done(),
    discard,
    send: () => void send(),
  }
}

export type SessionBrowserAnnotations = ReturnType<
  typeof useSessionBrowserAnnotations
>
