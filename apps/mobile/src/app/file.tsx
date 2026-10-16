import {
  csvDelimiterForMime,
  isCsvMime,
  isTextPreviewable,
  MAX_PREVIEW_BYTES,
  parseCsv,
  previewMarkdown,
} from "@repo/utils/file-preview"
import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams, useNavigation } from "expo-router"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useToast } from "heroui-native/toast"
import { useEffect, useState } from "react"
import { Image, ScrollView, Text, View } from "react-native"
import { CsvTable } from "@/components/csv-table"
import { FileTypeIcon } from "@/components/file-type-icon"
import { formatFileSize } from "@/components/message-attachments"
import { MessageContent } from "@/components/message-content"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { api } from "@/lib/api"
import { fetchMessageLocation } from "@/lib/message-location"
import { openExternalUrl } from "@/lib/open-url"
import { shareRemoteFile } from "@/lib/remote-file"

type ViewedFile = {
  name: string
  url: string | null
  mime: string
  size: number | null
  // Shown under the name when the file isn't a table.
  detail: string
}

type FileState = {
  file: ViewedFile | null
  sessionId: string | null
  isPending: boolean
  isError: boolean
  onRetry: () => void
}

type Table = ReturnType<typeof parseCsv>

function close() {
  if (router.canGoBack()) router.back()
  else router.replace("/")
}

// One of Lor's files (`artifactId`) or an upload (`messageId` + `index`),
// opened from a file chip anywhere. Read-only, like web's file panel.
export default function FileScreen() {
  const { artifactId, messageId, index } = useLocalSearchParams<{
    artifactId?: string
    messageId?: string
    index?: string
  }>()

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      {artifactId ? (
        <ArtifactFile artifactId={artifactId} />
      ) : messageId ? (
        <UploadFile index={Number(index ?? 0)} messageId={messageId} />
      ) : (
        <StatePanel
          action={{ label: "Close", onPress: close }}
          className="flex-1"
          detail="This link doesn't point to a file."
          status="danger"
          title="File unavailable"
        />
      )}
    </Screen>
  )
}

function ArtifactFile({ artifactId }: { artifactId: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: async () => {
      const res = await api.v1.artifacts[":artifactId"].$get({
        param: { artifactId },
      })
      if (!res.ok) throw new Error("Failed to fetch artifact")
      return res.json()
    },
  })
  const artifact = data?.artifact

  return (
    <FileView
      file={
        artifact
          ? {
              name: artifact.path,
              url: artifact.url,
              mime: artifact.mime,
              size: artifact.size,
              detail: `v${artifact.currentVersion}${artifact.size !== null ? ` · ${formatFileSize(artifact.size)}` : ""}`,
            }
          : null
      }
      isError={isError}
      isPending={isPending}
      onRetry={() => void refetch()}
      sessionId={data?.conversation?.sessionId ?? null}
    />
  )
}

// An upload is found through its message, with the message's access check.
function UploadFile({
  messageId,
  index,
}: {
  messageId: string
  index: number
}) {
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug ?? ""
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["message-location", workspaceSlug, messageId],
    enabled: workspaceSlug.length > 0,
    queryFn: async () => {
      const location = await fetchMessageLocation(workspaceSlug, messageId)
      if (!location) throw new Error("Message not found")
      return location
    },
  })
  const upload = data?.attachments?.[index]

  return (
    <FileView
      file={
        upload
          ? {
              name: upload.filename,
              url: upload.url,
              mime: upload.contentType,
              size: upload.size,
              detail: formatFileSize(upload.size),
            }
          : null
      }
      isError={isError || (data !== undefined && !upload)}
      isPending={isPending}
      onRetry={() => void refetch()}
      sessionId={data?.sessionId ?? null}
    />
  )
}

// The session on the screen under this one, when the file opened from it.
function useSessionBelow() {
  const navigation = useNavigation()
  const state = navigation.getState()
  const params = state?.routes[state.index - 1]?.params
  return params && "sessionId" in params ? params.sessionId : undefined
}

function textPreviewable(file: ViewedFile | null) {
  return (
    file?.url != null &&
    isTextPreviewable(file.mime) &&
    (file.size ?? 0) <= MAX_PREVIEW_BYTES
  )
}

function FileView({ file, sessionId, isPending, isError, onRetry }: FileState) {
  const { toast } = useToast()
  const [sharing, setSharing] = useState(false)
  // Hidden over the file's own session: that is its conversation.
  const sessionBelow = useSessionBelow()
  const openSessionId = sessionId !== sessionBelow ? sessionId : null
  const url = file?.url ?? null
  const mime = file?.mime ?? ""
  const content = useQuery({
    queryKey: ["file-content", url],
    enabled: textPreviewable(file),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string> => {
      if (!url) throw new Error("No file URL")
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch file")
      return res.text()
    },
  })
  const [table, setTable] = useState<Table | null>(null)
  // Parsed in a later task, not during render: a 2 MB CSV takes a moment, and
  // the spinner stays up until it's done.
  useEffect(() => {
    setTable(null)
    const text = content.data
    if (!isCsvMime(mime) || text === undefined) return
    const timer = setTimeout(() => {
      setTable(parseCsv(text, csvDelimiterForMime(mime)))
    }, 0)
    return () => clearTimeout(timer)
  }, [mime, content.data])

  const share = async () => {
    if (!file?.url || sharing) return
    setSharing(true)
    try {
      await shareRemoteFile({
        url: file.url,
        filename: file.name,
        contentType: file.mime,
      })
    } catch {
      toast.show({
        variant: "danger",
        label: "Couldn't share this file",
        description: "Please try again.",
      })
    } finally {
      setSharing(false)
    }
  }
  const openInBrowser = url ? () => openExternalUrl(url) : null

  return (
    <>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <HeaderButton
          label="Close"
          onPress={close}
          symbol={{ ios: "xmark", android: "close", web: "close" }}
        />
        <FileTypeIcon filename={file?.name ?? ""} />
        <View className="min-w-0 flex-1 gap-px">
          <Text
            className="text-[15px] font-semibold text-foreground"
            numberOfLines={1}
          >
            {file?.name ?? "File"}
          </Text>
          {file ? (
            <Text className="text-xs tabular-nums text-muted" numberOfLines={1}>
              {table
                ? `${table.rows.length.toLocaleString()} rows · ${table.columns.length.toLocaleString()} columns`
                : file.detail}
            </Text>
          ) : null}
        </View>
        {openSessionId ? (
          <HeaderButton
            label="Open session"
            onPress={() =>
              router.dismissTo({
                pathname: "/session/[sessionId]",
                params: { sessionId: openSessionId },
              })
            }
            symbol={{
              ios: "bubble.left.and.text.bubble.right",
              android: "forum",
              web: "forum",
            }}
          />
        ) : null}
        {openInBrowser ? (
          <>
            <HeaderButton
              busy={sharing}
              label="Share"
              onPress={share}
              symbol={{
                ios: "square.and.arrow.up",
                android: "share",
                web: "share",
              }}
            />
            <HeaderButton
              label="Open in browser"
              onPress={openInBrowser}
              symbol={{
                ios: "arrow.up.right.square",
                android: "open_in_new",
                web: "open_in_new",
              }}
            />
          </>
        ) : null}
      </View>
      <FileBody
        content={content}
        file={file}
        isError={isError}
        isPending={isPending}
        onOpenInBrowser={openInBrowser}
        onRetry={onRetry}
        onShare={share}
        sharing={sharing}
        table={table}
      />
    </>
  )
}

function FileBody({
  file,
  isPending,
  isError,
  onRetry,
  content,
  table,
  sharing,
  onShare,
  onOpenInBrowser,
}: {
  file: ViewedFile | null
  isPending: boolean
  isError: boolean
  onRetry: () => void
  content: UseQueryResult<string>
  table: Table | null
  sharing: boolean
  onShare: () => void
  onOpenInBrowser: (() => void) | null
}) {
  if (isPending) return <Loading />
  if (isError || !file) return <LoadFailed onRetry={onRetry} />

  if (
    file.url &&
    file.mime.startsWith("image/") &&
    file.mime !== "image/svg+xml"
  ) {
    return (
      <Image
        accessibilityLabel={file.name}
        resizeMode="contain"
        source={{ uri: file.url }}
        style={{ flex: 1 }}
      />
    )
  }

  if (!textPreviewable(file)) {
    return (
      <View className="flex-1 items-center justify-center gap-four px-eight">
        <FileTypeIcon filename={file.name} size={48} />
        <Text className="text-center text-sm text-muted">
          {isTextPreviewable(file.mime)
            ? "Too large to preview here."
            : "No preview for this file."}
        </Text>
        {onOpenInBrowser ? (
          <View className="flex-row gap-two">
            <Button isDisabled={sharing} onPress={onShare} size="sm">
              Share
            </Button>
            <Button onPress={onOpenInBrowser} size="sm" variant="secondary">
              Open in browser
            </Button>
          </View>
        ) : null}
      </View>
    )
  }

  if (content.isPending) return <Loading />
  if (content.isError) {
    return <LoadFailed onRetry={() => void content.refetch()} />
  }
  if (isCsvMime(file.mime)) {
    return table ? (
      <CsvTable columns={table.columns} rows={table.rows} />
    ) : (
      <Loading />
    )
  }
  return (
    <ScrollView contentContainerClassName="p-four">
      <MessageContent
        content={previewMarkdown(file.name, file.mime, content.data)}
        mentions={[]}
      />
    </ScrollView>
  )
}

function Loading() {
  return (
    <View className="flex-1 items-center justify-center">
      <Spinner accessibilityLabel="Loading file" />
    </View>
  )
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <StatePanel
      action={{ label: "Try again", onPress: onRetry }}
      className="flex-1"
      detail="Check your connection and try again."
      status="danger"
      title="Couldn't load this file"
    />
  )
}

function HeaderButton({
  label,
  symbol,
  onPress,
  busy = false,
}: {
  label: string
  symbol: SymbolViewProps["name"]
  onPress: () => void
  busy?: boolean
}) {
  const foreground = useThemeColor("foreground")
  return (
    <IconButton
      accessibilityLabel={label}
      isDisabled={busy}
      onPress={onPress}
      variant="ghost"
    >
      {busy ? (
        <Spinner size="sm" />
      ) : (
        <SymbolView name={symbol} size={19} tintColor={foreground} />
      )}
    </IconButton>
  )
}
