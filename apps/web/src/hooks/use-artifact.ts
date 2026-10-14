import { isTextPreviewable, MAX_PREVIEW_BYTES } from "@repo/utils/file-preview"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export function artifactQueryOptions(artifactId: string) {
  return {
    queryKey: ["artifact", artifactId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.artifacts[":artifactId"].$get({
        param: { artifactId },
      })
      if (!res.ok) throw new Error("Failed to fetch artifact")
      return res.json()
    },
  }
}

export function useArtifact(artifactId: string | null) {
  return useQuery({
    ...artifactQueryOptions(artifactId ?? ""),
    enabled: artifactId !== null,
  })
}

// Text body of the current version, fetched straight from the public blob URL
// (same access model as message attachments).
export function useArtifactContent(args: {
  url: string | null
  mime: string | null
  size: number | null
}) {
  const { url, mime, size } = args
  const renderable =
    url !== null &&
    mime !== null &&
    isTextPreviewable(mime) &&
    (size ?? 0) <= MAX_PREVIEW_BYTES
  return useQuery({
    queryKey: ["artifact-content", url] as const,
    enabled: renderable,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string> => {
      if (!url) throw new Error("No artifact URL")
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch artifact content")
      return res.text()
    },
  })
}
