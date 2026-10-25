import { Spinner } from "@repo/ui/components/spinner"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@repo/ui/components/tabs"
import { type ReactNode, useState } from "react"

function ImageCanvas({ url, path }: { url: string; path: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative flex min-h-40 items-center justify-center overflow-auto rounded-lg border border-border/70 bg-muted/30 p-4">
      {failed ? (
        <p role="alert" className="text-muted-foreground text-sm">
          Couldn't preview this image.
        </p>
      ) : (
        <>
          {!loaded && (
            <Spinner aria-label="Loading image" className="absolute size-5" />
          )}
          <img
            src={url}
            alt={path}
            className="max-h-[70vh] max-w-full object-contain"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      )}
    </div>
  )
}

export function ImagePreview({
  url,
  path,
  source,
}: {
  url: string
  path: string
  source?: ReactNode
}) {
  const preview = <ImageCanvas key={url} url={url} path={path} />
  if (source === undefined) return preview
  return (
    <Tabs key={path} defaultValue="preview" className="min-w-0 gap-3">
      <TabsList aria-label="Image view">
        <TabsTab value="preview">Preview</TabsTab>
        <TabsTab value="source">Source</TabsTab>
      </TabsList>
      <TabsPanel value="preview">{preview}</TabsPanel>
      <TabsPanel value="source">{source}</TabsPanel>
    </Tabs>
  )
}
