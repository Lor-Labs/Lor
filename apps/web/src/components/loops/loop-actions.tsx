import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { ChannelLoop } from "@/hooks/use-channel-loops"
import { apiClient } from "@/lib/api-client"

// Activation flow shared by the loop card's quick button and the loop detail
// panel: POST activate with the given tz; a 422 requires_confirmation parks
// firesPerDay in state so the caller renders <LoopFrequencyDialog/>, which
// resends with confirmHighFrequency.
export function useActivateLoop(loop: ChannelLoop | null, timezone: string) {
  const queryClient = useQueryClient()
  const [confirmFires, setConfirmFires] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: async (opts: { confirm?: boolean }) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await apiClient.v1.loops[":loopId"].activate.$post({
        param: { loopId: loop.id },
        json: {
          timezone,
          ...(opts.confirm ? { confirmHighFrequency: true } : {}),
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        return {
          kind: "needs_confirmation" as const,
          firesPerDay: body.firesPerDay,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to create the loop")
      }
      const body = await res.json()
      return { kind: "activated" as const, loop: body.loop }
    },
    onSuccess: (result) => {
      if (result.kind === "needs_confirmation") {
        setConfirmFires(result.firesPerDay)
        return
      }
      // loop:updated also lands via the socket; setting directly makes the
      // flip immediate even on a slow connection.
      queryClient.setQueryData(
        ["channel-loops", result.loop.channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== result.loop.id)
          return [result.loop, ...rest]
        }
      )
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to create the loop"
      )
    },
  })

  return {
    activate: (opts?: { confirm?: boolean }) => {
      setConfirmFires(null)
      mutation.mutate(opts ?? {})
    },
    isPending: mutation.isPending,
    confirmFires,
    dismissConfirm: () => setConfirmFires(null),
  }
}

// Loop edits (schedule/instructions/name) from the panel. Optimistic — the
// controls reflect the change immediately; a rejected edit refetches so they
// snap back. A 422 on schedule edits (tightened sub-hourly cadence) parks
// the input in confirm state so the caller shows <LoopFrequencyDialog/> and
// resends with confirm.
export type UpdateLoopInput = {
  schedule?: string
  instructions?: string
  name?: string
  // End modes, mutually exclusive; explicit null clears (both null = never).
  endAt?: string | null
  endCondition?: string | null
  confirm?: boolean
}

export function useUpdateLoop(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  const [confirmState, setConfirmState] = useState<{
    input: UpdateLoopInput
    firesPerDay: number
  } | null>(null)

  const mutation = useMutation({
    mutationFn: async (input: UpdateLoopInput) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await apiClient.v1.loops[":loopId"].$patch({
        param: { loopId: loop.id },
        json: {
          ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
          ...(input.instructions !== undefined
            ? { instructions: input.instructions }
            : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
          ...(input.endCondition !== undefined
            ? { endCondition: input.endCondition }
            : {}),
          ...(input.confirm ? { confirmHighFrequency: true } : {}),
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        return {
          kind: "needs_confirmation" as const,
          input,
          firesPerDay: body.firesPerDay,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to update the loop")
      }
      const body = await res.json()
      return { kind: "updated" as const, loop: body.loop }
    },
    onMutate: (input) => {
      if (!loop) return
      queryClient.setQueryData(
        ["channel-loops", loop.channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.map((l) =>
            l.id === loop.id
              ? {
                  ...l,
                  ...(input.schedule !== undefined
                    ? { schedule: input.schedule }
                    : {}),
                  ...(input.instructions !== undefined
                    ? { instructions: input.instructions }
                    : {}),
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
                  ...(input.endCondition !== undefined
                    ? { endCondition: input.endCondition }
                    : {}),
                }
              : l
          )
      )
    },
    onSuccess: (result) => {
      if (result.kind === "needs_confirmation") {
        // The optimistic write showed a change the server didn't take — roll
        // back to the truth while the confirm dialog is up.
        if (loop) {
          void queryClient.invalidateQueries({
            queryKey: ["channel-loops", loop.channelId],
          })
        }
        setConfirmState({
          input: result.input,
          firesPerDay: result.firesPerDay,
        })
        return
      }
      queryClient.setQueryData(
        ["channel-loops", result.loop.channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.map((l) => (l.id === result.loop.id ? result.loop : l))
      )
    },
    onError: (err) => {
      if (loop) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-loops", loop.channelId],
        })
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to update the loop"
      )
    },
  })

  return {
    update: (input: UpdateLoopInput) => {
      setConfirmState(null)
      mutation.mutate(input)
    },
    isPending: mutation.isPending,
    confirmState,
    dismissConfirm: () => setConfirmState(null),
  }
}

// Pause / resume / mark-completed from the loop panel. All three return the
// updated snapshot; wrong-state races land as 409s and just toast.
export type LoopLifecycleAction = "pause" | "resume" | "complete"

export function useLoopLifecycle(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (action: LoopLifecycleAction) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const client = apiClient.v1.loops[":loopId"]
      const param = { loopId: loop.id }
      const res =
        action === "pause"
          ? await client.pause.$post({ param })
          : action === "resume"
            ? await client.resume.$post({ param })
            : await client.complete.$post({ param })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `Failed to ${action} the loop`)
      }
      const body = await res.json()
      return body.loop
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["channel-loops", updated.channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== updated.id)
          return [updated, ...rest]
        }
      )
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Loop action failed")
    },
  })

  return mutation
}

// Hard delete from the … menu — the server removes the card message too and
// broadcasts loop:deleted; the local cache removal here just beats the socket.
export function useDeleteLoop(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await apiClient.v1.loops[":loopId"].$delete({
        param: { loopId: loop.id },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to delete the loop")
      }
      return res.json()
    },
    onSuccess: () => {
      if (!loop) return
      queryClient.setQueryData(
        ["channel-loops", loop.channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.filter((l) => l.id !== loop.id)
      )
      queryClient.removeQueries({ queryKey: ["loop-runs", loop.id] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete the loop"
      )
    },
  })
}

export function LoopFrequencyDialog({
  scheduleText,
  firesPerDay,
  onConfirm,
  onDismiss,
}: {
  scheduleText: string
  firesPerDay: number | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <AlertDialog
      open={firesPerDay !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Frequent schedule</AlertDialogTitle>
          <AlertDialogDescription>
            This loop runs{" "}
            <span className="font-semibold text-foreground">
              {scheduleText.toLowerCase()}
            </span>{" "}
            — up to {firesPerDay} times a day. Each run uses Merlin credits.
            Create it anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button onClick={onConfirm}>Create Loop</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
