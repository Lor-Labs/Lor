import { useCallback, useRef } from "react"

// Same identity on every render, always calling the latest `fn`, so a
// memoized child (MessageInput) skips the host's re-renders, e.g. Lor stream
// frames. Undefined while `fn` is, for props whose presence means something.
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result
export function useStableCallback<Args extends unknown[], Result>(
  fn: ((...args: Args) => Result) | undefined
): ((...args: Args) => Result) | undefined
export function useStableCallback<Args extends unknown[], Result>(
  fn: ((...args: Args) => Result) | undefined
) {
  const ref = useRef(fn)
  ref.current = fn
  const stable = useCallback(
    (...args: Args) => ref.current?.(...args) as Result,
    []
  )
  return fn ? stable : undefined
}
