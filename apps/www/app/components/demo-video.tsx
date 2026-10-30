import { DEMO_VIDEO } from "@/app/lib/launch"

export function DemoVideo() {
  if (!DEMO_VIDEO.src) return null

  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-black shadow-2xl">
        <video
          controls
          playsInline
          preload="metadata"
          crossOrigin={DEMO_VIDEO.captions ? "anonymous" : undefined}
          poster={DEMO_VIDEO.poster || undefined}
          aria-label="A walkthrough of the app"
          className="aspect-video w-full"
          src={DEMO_VIDEO.src}
        >
          {DEMO_VIDEO.captions ? (
            <track
              kind="captions"
              src={DEMO_VIDEO.captions}
              srcLang="en"
              label="English"
              default
            />
          ) : null}
          Your browser does not support this video. You can{" "}
          <a href={DEMO_VIDEO.src}>watch the walkthrough here</a>.
        </video>
      </div>
      <figcaption className="mt-4 text-center text-sm text-muted-foreground">
        A walkthrough of the app.
      </figcaption>
    </figure>
  )
}
