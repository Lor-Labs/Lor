import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, FileUp, FolderOpen } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { ConnectorKey } from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"

const SEARCH_DEBOUNCE_MS = 200
const RECORDS_STALE_MS = 30 * 1000
const SCOPES_STALE_MS = 5 * 60 * 1000

export interface AttachableConnector {
  id: ConnectorKey
  label: string
  supportsFiles: boolean
}

export interface ConnectorRecord {
  id: string
  title: string
  subtitle: string | null
  url: string
}

interface ConnectorScope {
  id: string
  label: string
}

// root → a connector's records → (files only) its containers → paths in one.
type View =
  | { kind: "root" }
  | { kind: "records"; connector: AttachableConnector }
  | { kind: "scopes"; connector: AttachableConnector }
  | { kind: "files"; connector: AttachableConnector; scope: ConnectorScope }

interface MenuItem {
  key: string
  title: string
  subtitle?: string | null
  chevron?: boolean
  onSelect: () => void
}

interface ConnectorAttachMenuProps {
  connectors: AttachableConnector[]
  workspaceSlug?: string
  channelId?: string
  onUploadFile: () => void
  onAttach: (connector: ConnectorKey, record: ConnectorRecord) => void
}

const rowClassName =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 hover:bg-accent hover:text-accent-foreground"

export function ConnectorAttachMenu({
  connectors,
  workspaceSlug,
  channelId,
  onUploadFile,
  onAttach,
}: ConnectorAttachMenuProps) {
  const [view, setView] = useState<View>({ kind: "root" })
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (view.kind !== "root") inputRef.current?.focus()
  }, [view.kind])

  const connector = view.kind === "root" ? null : view.connector
  const scope = view.kind === "files" ? view.scope : null
  const param = {
    workspaceSlug: workspaceSlug as string,
    channelId: channelId as string,
    provider: connector?.id as ConnectorKey,
  }

  const { data: recordsData, isFetching: isFetchingRecords } = useQuery({
    queryKey: [
      "connector-records",
      workspaceSlug,
      channelId,
      connector?.id,
      debouncedQuery,
    ],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors[":provider"].search.$get({
        param,
        query: { q: debouncedQuery },
      })
      if (!res.ok) throw new Error("Connector search failed")
      return res.json()
    },
    enabled: view.kind === "records" && Boolean(workspaceSlug && channelId),
    staleTime: RECORDS_STALE_MS,
    placeholderData: (previous) => previous,
  })

  const { data: scopesData, isFetching: isFetchingScopes } = useQuery({
    queryKey: ["connector-scopes", workspaceSlug, channelId, connector?.id],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors[":provider"].scopes.$get({ param })
      if (!res.ok) throw new Error("Failed to load scopes")
      return res.json()
    },
    enabled:
      (view.kind === "scopes" || view.kind === "files") &&
      Boolean(workspaceSlug && channelId),
    staleTime: SCOPES_STALE_MS,
  })

  const { data: filesData, isFetching: isFetchingFiles } = useQuery({
    queryKey: [
      "connector-files",
      workspaceSlug,
      channelId,
      connector?.id,
      scope?.id,
      debouncedQuery,
    ],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors[":provider"].files.$get({
        param,
        query: { scope: scope?.id as string, q: debouncedQuery },
      })
      if (!res.ok) throw new Error("File search failed")
      return res.json()
    },
    enabled: view.kind === "files" && Boolean(workspaceSlug && channelId),
    staleTime: RECORDS_STALE_MS,
    placeholderData: (previous) => previous,
  })

  const go = (next: View) => {
    setView(next)
    setQuery("")
    setDebouncedQuery("")
  }

  const back = () => {
    if (view.kind === "files")
      return go({ kind: "scopes", connector: view.connector })
    if (view.kind === "scopes")
      return go({ kind: "records", connector: view.connector })
    go({ kind: "root" })
  }

  const attach = (record: ConnectorRecord) => {
    if (connector) onAttach(connector.id, record)
  }

  const recordItems: MenuItem[] = (recordsData?.results ?? []).map(
    (record) => ({
      key: record.url,
      title: record.title,
      subtitle: record.subtitle,
      onSelect: () => attach(record),
    })
  )

  const normalizedQuery = query.trim().toLowerCase()
  const scopeItems: MenuItem[] = (scopesData?.scopes ?? [])
    .filter((candidate) =>
      candidate.label.toLowerCase().includes(normalizedQuery)
    )
    .map((candidate) => ({
      key: candidate.id,
      title: candidate.label,
      chevron: true,
      onSelect: () =>
        connector && go({ kind: "files", connector, scope: candidate }),
    }))

  const fileItems: MenuItem[] = (filesData?.results ?? []).map((record) => ({
    key: record.url,
    title: record.title,
    subtitle: record.subtitle,
    onSelect: () => attach(record),
  }))

  // Offered only before the user types, so Enter always resolves to a search
  // result once there is a query.
  const browseFilesItem: MenuItem[] =
    view.kind === "records" &&
    view.connector.supportsFiles &&
    query.length === 0
      ? [
          {
            key: "__browse-files",
            title: "Browse files",
            subtitle: "Attach a file or folder by path",
            chevron: true,
            onSelect: () => go({ kind: "scopes", connector: view.connector }),
          },
        ]
      : []

  const items =
    view.kind === "records"
      ? [...browseFilesItem, ...recordItems]
      : view.kind === "scopes"
        ? scopeItems
        : fileItems

  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, view.kind])

  const isFetching =
    view.kind === "records"
      ? isFetchingRecords
      : view.kind === "scopes"
        ? isFetchingScopes
        : isFetchingFiles

  if (view.kind === "root") {
    return (
      <div className="grid gap-1">
        <button type="button" className={rowClassName} onClick={onUploadFile}>
          <FileUp className="size-4 text-muted-foreground" />
          Upload File
        </button>
        {connectors.length > 0 && (
          <div className="my-1 h-px bg-border" aria-hidden="true" />
        )}
        {connectors.map((candidate) => {
          const Logo = connectorLogo(candidate.id)
          return (
            <button
              key={candidate.id}
              type="button"
              className={rowClassName}
              onClick={() => go({ kind: "records", connector: candidate })}
            >
              <Logo className="size-4 text-muted-foreground" />
              Add from {candidate.label}
              <ChevronRight className="ml-auto size-4 text-muted-foreground" />
            </button>
          )
        })}
      </div>
    )
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => (index + 1) % items.length)
      return
    }
    if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => (index + items.length - 1) % items.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      items[selectedIndex]?.onSelect()
      return
    }
    // Escape closes the popover; backspace on an empty query steps back a level.
    if (event.key === "Backspace" && query.length === 0) {
      event.preventDefault()
      back()
    }
  }

  const ActiveLogo = connectorLogo(view.connector.id)
  const heading =
    view.kind === "files" ? view.scope.label : view.connector.label
  const placeholder =
    view.kind === "scopes"
      ? "Filter repositories…"
      : view.kind === "files"
        ? "Search paths…"
        : `Search ${view.connector.label}…`

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          type="button"
          onClick={back}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="size-4" />
        </button>
        {view.kind === "files" ? (
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ActiveLogo className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{heading}</span>
        {isFetching && <Spinner className="ml-auto size-3.5 shrink-0" />}
      </div>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {isFetching ? "Searching…" : "No results"}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/70"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={item.onSelect}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{item.title}</span>
                {item.subtitle && (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                )}
              </span>
              {item.chevron && (
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
