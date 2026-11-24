import { useState } from "react"

export function VideoPreview({ url, path }: { url: string; path: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <p role="alert" className="text-muted-foreground text-sm">
      Couldn't play this video. Download it to watch in another player.
    </p>
  ) : (
    <video
      aria-label={path}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="max-h-[70dvh] w-full rounded-lg bg-black object-contain"
      onError={() => setFailed(true)}
    >
      <track kind="captions" />
    </video>
  )
}
