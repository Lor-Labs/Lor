import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import {
  everyoneMentionCandidate,
  type MentionCandidate,
  workspaceMemberToMentionCandidate,
} from "@/lib/mentions"

export function useWorkspaceMentionCandidates({
  workspaceSlug,
  currentUserId,
}: {
  workspaceSlug: string
  currentUserId?: string
}) {
  const [candidates, setCandidates] = useState<MentionCandidate[]>([
    everyoneMentionCandidate,
  ])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestRef.current

    if (!workspaceSlug) {
      setCandidates([everyoneMentionCandidate])
      setError(null)
      setIsLoading(false)
      return
    }

    setCandidates([everyoneMentionCandidate])
    setError(null)
    setIsLoading(true)

    void (async () => {
      try {
        const response = await api.v1.workspaces[":workspaceSlug"].members.$get(
          { param: { workspaceSlug } }
        )
        if (!response.ok) throw new Error("Could not load workspace members")
        const payload = await response.json()
        if (requestId !== requestRef.current) return

        setCandidates([
          everyoneMentionCandidate,
          ...payload.members
            .filter((member) => member.userId !== currentUserId)
            .map(workspaceMemberToMentionCandidate),
        ])
      } catch (cause) {
        if (requestId !== requestRef.current) return
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load workspace members"
        )
      } finally {
        if (requestId === requestRef.current) setIsLoading(false)
      }
    })()
  }, [workspaceSlug, currentUserId])

  return { candidates, isLoading, error }
}
