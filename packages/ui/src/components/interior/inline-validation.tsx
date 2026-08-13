"use client"

import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useId, useRef, useState } from "react"

const CROSSFADE = {
  type: "spring",
  stiffness: 260,
  damping: 34,
  mass: 0.8,
} as const
const INSTANT = { duration: 0 } as const

const LINE = 16

export type ValidationStatus = "idle" | "pending" | "valid" | "invalid"

export type Validator = (value: string) => string | null

export type UseInlineValidationOptions = {
  value: string
  validate: Validator
  debounce?: number
}

export type UseInlineValidationReturn = {
  status: ValidationStatus
  error: string | null
  message: string
  touched: boolean
  commit: () => void
  reset: () => void
  fieldProps: {
    onBlur: () => void
    "aria-invalid": boolean
  }
}

type Settled = {
  status: ValidationStatus
  error: string | null
  message: string
}

const CLEAN: Settled = { status: "idle", error: null, message: "" }

export function useInlineValidation({
  value,
  validate,
  debounce = 400,
}: UseInlineValidationOptions): UseInlineValidationReturn {
  const [touched, setTouched] = useState(false)
  const [settled, setSettled] = useState<Settled>(CLEAN)

  const check = useRef(validate)
  const latest = useRef(value)

  useEffect(() => {
    check.current = validate
    latest.current = value
  })

  useEffect(() => {
    if (!touched) return

    const next = check.current(value)
    const resolved: ValidationStatus = value.length > 0 ? "valid" : "idle"

    if (next === null) {
      setSettled((prev) =>
        prev.status === resolved && prev.error === null
          ? prev
          : { status: resolved, error: null, message: prev.message }
      )
      return
    }

    setSettled((prev) =>
      prev.status === "invalid"
        ? prev
        : { status: "pending", error: null, message: prev.message }
    )

    const t = setTimeout(() => {
      setSettled((prev) =>
        prev.error === next
          ? prev
          : { status: "invalid", error: next, message: next }
      )
    }, debounce)

    return () => clearTimeout(t)
  }, [value, touched, debounce])

  const commit = useCallback(() => {
    setTouched(true)
    const v = latest.current
    const next = check.current(v)
    setSettled((prev) =>
      next === null
        ? {
            status: v.length > 0 ? "valid" : "idle",
            error: null,
            message: prev.message,
          }
        : { status: "invalid", error: next, message: next }
    )
  }, [])

  const reset = useCallback(() => {
    setTouched(false)
    setSettled(CLEAN)
  }, [])

  return {
    status: settled.status,
    error: settled.error,
    message: settled.message,
    touched,
    commit,
    reset,
    fieldProps: {
      onBlur: commit,
      "aria-invalid": settled.status === "invalid",
    },
  }
}

export type InlineValidationProps = {
  label: string
  value: string
  onChange: (value: string) => void
  validate: Validator
  hint?: string
  id?: string
  name?: string
  type?: "text" | "email" | "password" | "tel" | "url" | "search"
  placeholder?: string
  autoComplete?: string
  inputMode?: React.ComponentProps<"input">["inputMode"]
  debounce?: number
  reserveLines?: number
  disabled?: boolean
  required?: boolean
  className?: string
}

export function InlineValidation({
  label,
  value,
  onChange,
  validate,
  hint,
  id,
  name,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  debounce = 400,
  reserveLines = 0,
  disabled = false,
  required = false,
  className = "",
}: InlineValidationProps) {
  const reduced = useReducedMotion()
  const fade = reduced ? INSTANT : CROSSFADE

  const auto = useId()
  const fieldId = id ?? `${auto}-field`
  const hintId = `${auto}-hint`
  const errorId = `${auto}-error`

  const { status, error, message, fieldProps } = useInlineValidation({
    value,
    validate,
    debounce,
  })

  const invalid = status === "invalid"
  const valid = status === "valid"

  const described = [hint ? hintId : null, invalid ? errorId : null]
    .filter(Boolean)
    .join(" ")

  const clamp =
    reserveLines > 0
      ? {
          display: "-webkit-box" as const,
          WebkitBoxOrient: "vertical" as const,
          WebkitLineClamp: reserveLines,
          overflow: "hidden" as const,
        }
      : undefined

  return (
    <div className={cn("w-full", className)}>
      <Label htmlFor={fieldId}>{label}</Label>

      <div className="relative mt-2">
        <Input
          id={fieldId}
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-describedby={described || undefined}
          onChange={(event) => onChange(event.target.value)}
          {...fieldProps}
          className="**:data-[slot=input]:pr-9"
        />

        <span
          className="pointer-events-none absolute right-3 top-1/2 grid size-3.5 -translate-y-1/2 place-items-center"
          aria-hidden
        >
          <motion.svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            fill="none"
            className="col-start-1 row-start-1 text-muted-foreground"
            initial={false}
            animate={{ opacity: valid ? 1 : 0, scale: valid ? 1 : 0.7 }}
            transition={fade}
          >
            <path
              d="M2 6.3 4.7 9 10 3.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
          <motion.svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            fill="none"
            className="col-start-1 row-start-1 text-destructive"
            initial={false}
            animate={{ opacity: invalid ? 1 : 0, scale: invalid ? 1 : 0.7 }}
            transition={fade}
          >
            <path
              d="M6 2v4.4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <rect
              x="5.15"
              y="8.4"
              width="1.7"
              height="1.7"
              rx="0.5"
              fill="currentColor"
            />
          </motion.svg>
        </span>
      </div>

      <div
        style={
          reserveLines > 0 ? { minHeight: reserveLines * LINE } : undefined
        }
      >
        <AnimatePresence initial={false} mode="popLayout">
          {invalid ? (
            <motion.p
              key="error"
              id={errorId}
              aria-live="polite"
              aria-atomic="true"
              style={clamp}
              className="overflow-hidden text-xs leading-4 text-destructive"
              initial={{ height: 0, marginTop: 0, opacity: 0, y: -2 }}
              animate={{ height: "auto", marginTop: 6, opacity: 1, y: 0 }}
              exit={{ height: 0, marginTop: 0, opacity: 0, y: -2 }}
              transition={fade}
            >
              {error ?? message}
            </motion.p>
          ) : hint ? (
            <motion.p
              key="hint"
              id={hintId}
              style={clamp}
              className="overflow-hidden text-xs leading-4 text-muted-foreground"
              initial={{ height: 0, marginTop: 0, opacity: 0, y: -2 }}
              animate={{ height: "auto", marginTop: 6, opacity: 1, y: 0 }}
              exit={{ height: 0, marginTop: 0, opacity: 0, y: -2 }}
              transition={fade}
            >
              {hint}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
