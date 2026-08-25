// Compile-time drift guards for wire snapshot types. The realtime-types
// package hand-writes its payload types (it must stay dependency-free so
// web/mobile can consume it without @repo/db in their type graph), so each
// snapshot type asserts — in @repo/merlin, which sees both sides — that it
// exactly mirrors its date-serialized DB row. A schema change that would
// drift the wire shape fails check-types at the guard instead of rotting
// silently. See toRealtimeLoop (loops.ts) / toRealtimeTask (tasks.ts).

export type SerializedDates<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K]
}

export type Exact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never
