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

// Draft-only schedule edit from the panel's structured rows. Optimistic:
// the Selects reflect the change immediately; a rejected edit refetches the
// channel's loops so the row snaps back to the truth.
export function useUpdateLoopSchedule(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (schedule: string) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await apiClient.v1.loops[":loopId"].$patch({
        param: { loopId: loop.id },
        json: { schedule },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to update the schedule")
      }
      const body = await res.json()
      return body.loop
    },
    onMutate: (schedule) => {
      if (!loop) return
      queryClient.setQueryData(
        ["channel-loops", loop.channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.map((l) => (l.id === loop.id ? { ...l, schedule } : l))
      )
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["channel-loops", updated.channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.map((l) => (l.id === updated.id ? updated : l))
      )
    },
    onError: (err) => {
      if (loop) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-loops", loop.channelId],
        })
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to update the schedule"
      )
    },
  })
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
