import { appFetch } from "@repo/auth/tauri-fetch"
import { env } from "@repo/env/client"
import { useSyncExternalStore } from "react"

const PROBE_TIMEOUT = 5000
const RETRY_DELAY = 5000

// Desktop only. A browser that loses its connection can't load the SPA in the
// first place, so the probe would be noise there — the web build always reads
// as online and every gate below it is inert.
const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

type ConnectivityStatus = "unknown" | "online" | "offline"

type Connectivity = {
  status: ConnectivityStatus
  isChecking: boolean
}

let snapshot: Connectivity = {
  status: isDesktop ? "unknown" : "online",
  isChecking: false,
}

const listeners = new Set<() => void>()
let probe: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let started = false

function emit(next: Connectivity) {
  if (
    next.status === snapshot.status &&
    next.isChecking === snapshot.isChecking
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) listener()
}

function clearRetry() {
  if (retryTimer === null) return
  clearTimeout(retryTimer)
  retryTimer = null
}

function goOffline() {
  emit({ status: "offline", isChecking: false })
  if (retryTimer !== null) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void checkConnectivity()
  }, RETRY_DELAY)
}

/**
 * Any HTTP response — a 500 included — proves the machine is on a network, so
 * only a thrown fetch (DNS failure, refused connection, timeout) counts as
 * offline. An API outage must never be misreported as "no internet".
 */
export function checkConnectivity(): Promise<void> {
  if (!isDesktop) return Promise.resolve()
  if (probe) return probe
  clearRetry()

  if (!navigator.onLine) {
    goOffline()
    return Promise.resolve()
  }

  emit({ ...snapshot, isChecking: true })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT)
  probe = appFetch(env.NEXT_PUBLIC_API_URL, {
    method: "GET",
    signal: controller.signal,
  })
    .then(() => {
      emit({ status: "online", isChecking: false })
    })
    .catch(() => {
      goOffline()
    })
    .finally(() => {
      clearTimeout(timeout)
      probe = null
    })
  return probe
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (isDesktop && !started) {
    started = true
    window.addEventListener("online", () => void checkConnectivity())
    window.addEventListener("offline", goOffline)
    void checkConnectivity()
  }
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

export function useConnectivity() {
  const { status, isChecking } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  )
  return { status, isChecking, recheck: checkConnectivity }
}
