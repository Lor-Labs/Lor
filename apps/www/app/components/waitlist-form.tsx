"use client"

import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { type FormEvent, useEffect, useId, useRef, useState } from "react"

const REQUEST_TIMEOUT_MS = 12_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVALID_EMAIL = "That email doesn't look right."
const REQUEST_ERROR = "Something went wrong on our end. Please try again."
const TIMEOUT_ERROR = "That took too long. Please try again."
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]"

type FormState =
  | { status: "idle" | "submitting" | "success" | "duplicate" }
  | { status: "error"; message: string; invalidEmail?: boolean }

export function WaitlistForm({
  className = "",
  align = "start",
}: {
  className?: string
  align?: "start" | "center"
}) {
  const id = useId()
  const emailId = `${id}-email`
  const errorId = `${id}-error`
  const emailInput = useRef<HTMLInputElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const [email, setEmail] = useState("")
  const [state, setState] = useState<FormState>({ status: "idle" })
  const isSubmitting = state.status === "submitting"
  const isComplete = state.status === "success" || state.status === "duplicate"
  const hasError = state.status === "error"

  useEffect(() => {
    return () => {
      activeRequest.current?.abort()
      activeRequest.current = null
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeRequest.current || isComplete) return

    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
      setState({ status: "error", message: INVALID_EMAIL, invalidEmail: true })
      emailInput.current?.focus()
      return
    }

    setEmail(normalizedEmail)
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: "submitting" })
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let receivedResponse = false

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
        signal: controller.signal,
      })
      receivedResponse = true
      if (activeRequest.current !== controller) return

      if (response.status === 200) {
        const result: unknown = await response.json()
        if (activeRequest.current !== controller) return
        if (
          result &&
          typeof result === "object" &&
          "success" in result &&
          result.success === true
        ) {
          setState({ status: "success" })
        } else {
          setState({ status: "error", message: REQUEST_ERROR })
        }
      } else if (response.status === 409) {
        setState({ status: "duplicate" })
      } else if (response.status === 400) {
        setState({
          status: "error",
          message: INVALID_EMAIL,
          invalidEmail: true,
        })
        emailInput.current?.focus()
      } else {
        const messages: Record<number, string> = {
          429: "Too many tries. Wait a minute, then try again.",
          503: "Signups are paused for a moment. Please try again soon.",
          504: TIMEOUT_ERROR,
        }
        setState({
          status: "error",
          message: messages[response.status] ?? REQUEST_ERROR,
        })
      }
    } catch {
      if (activeRequest.current !== controller) return
      setState({
        status: "error",
        message: controller.signal.aborted
          ? TIMEOUT_ERROR
          : receivedResponse
            ? REQUEST_ERROR
            : "We couldn't reach the server. Check your connection and try again.",
      })
    } finally {
      clearTimeout(timeout)
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  return (
    <div className={`relative w-full max-w-[440px] ${className}`}>
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label="Early access"
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor={emailId} className="sr-only">
          Work email
        </label>
        <input
          ref={emailInput}
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          required
          maxLength={254}
          placeholder="you@company.com"
          value={email}
          readOnly={isSubmitting}
          aria-invalid={hasError && state.invalidEmail ? true : undefined}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => {
            if (activeRequest.current) return
            const nextEmail = event.target.value
            setEmail(nextEmail)
            if (
              !isComplete ||
              nextEmail.trim().toLowerCase() !== email.trim().toLowerCase()
            ) {
              setState({ status: "idle" })
            }
          }}
          className="h-12 min-h-12 w-full min-w-0 flex-none rounded-full border border-foreground/[0.12] bg-foreground/[0.03] px-5 text-base text-foreground outline-none transition-colors duration-300 placeholder:text-muted-foreground/70 read-only:opacity-60 focus:border-agent/60 focus:bg-foreground/[0.05] sm:w-auto sm:flex-1"
        />
        <button
          type="submit"
          disabled={isSubmitting || isComplete}
          aria-busy={isSubmitting}
          className={`group inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-b from-agent to-primary pr-5 pl-6 font-medium text-[15px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.3),0_4px_10px_-2px_rgba(97,60,214,0.4),0_10px_24px_-6px_rgba(97,60,214,0.3)] transition-all duration-300 ${EASE} hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60`}
        >
          {isSubmitting ? "Adding you…" : "Get early access"}
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            strokeWidth={1.75}
            className={`transition-transform duration-300 ${EASE} group-hover:translate-x-0.5`}
          />
        </button>
      </form>
      <div
        className={`absolute inset-x-0 top-full mt-3 text-[13px] leading-relaxed ${
          align === "center" ? "text-center" : "px-5"
        }`}
      >
        <p
          id={errorId}
          role="alert"
          aria-atomic="true"
          className="text-destructive"
        >
          {hasError ? state.message : null}
        </p>
        <p role="status" aria-atomic="true" className="text-agent">
          {state.status === "success"
            ? "You're on the list. We'll be in touch."
            : state.status === "duplicate"
              ? "You're already on the list. We'll be in touch."
              : null}
        </p>
      </div>
    </div>
  )
}
