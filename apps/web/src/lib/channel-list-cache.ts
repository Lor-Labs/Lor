import type { QueryClient } from "@tanstack/react-query"
import type { ListChannelsResponse } from "@/lib/api-types"

type ChannelRow = ListChannelsResponse["uncategorized"][number]

const channelListKey = (workspaceSlug: string) =>
  ["channels", workspaceSlug] as const

// Channel create, rename and delete patch the sidebar's channel list before
// (or instead of) a refetch. Returns the list to restore on failure.
export async function patchChannelList(
  queryClient: QueryClient,
  workspaceSlug: string,
  update: (list: ListChannelsResponse) => ListChannelsResponse
) {
  const queryKey = channelListKey(workspaceSlug)
  await queryClient.cancelQueries({ queryKey })
  const previous = queryClient.getQueryData<ListChannelsResponse>(queryKey)
  queryClient.setQueryData<ListChannelsResponse>(queryKey, (list) =>
    list ? update(list) : list
  )
  return previous
}

export function restoreChannelList(
  queryClient: QueryClient,
  workspaceSlug: string,
  previous: ListChannelsResponse | undefined
) {
  queryClient.setQueryData(channelListKey(workspaceSlug), previous)
}

// Replaces a channel (or category) in place, or adds a new one at the end of
// its parent, where the server puts it (max position + 1).
export function upsertChannel(
  list: ListChannelsResponse,
  channel: ChannelRow
): ListChannelsResponse {
  const replace = (rows: ChannelRow[]) =>
    rows.map((row) => (row.id === channel.id ? { ...row, ...channel } : row))
  const listed =
    list.uncategorized.some((row) => row.id === channel.id) ||
    list.categories.some(
      (category) =>
        category.id === channel.id ||
        category.channels.some((row) => row.id === channel.id)
    )
  if (listed) {
    return {
      uncategorized: replace(list.uncategorized),
      categories: list.categories.map((category) =>
        category.id === channel.id
          ? { ...category, ...channel }
          : { ...category, channels: replace(category.channels) }
      ),
    }
  }
  if (channel.type === "category") {
    return {
      ...list,
      categories: [...list.categories, { ...channel, channels: [] }],
    }
  }
  if (channel.parentId) {
    return {
      ...list,
      categories: list.categories.map((category) =>
        category.id === channel.parentId
          ? { ...category, channels: [...category.channels, channel] }
          : category
      ),
    }
  }
  return { ...list, uncategorized: [...list.uncategorized, channel] }
}

// A deleted category's channels become uncategorized, as on the server.
export function removeChannel(
  list: ListChannelsResponse,
  channelId: string
): ListChannelsResponse {
  const removedCategory = list.categories.find(
    (category) => category.id === channelId
  )
  return {
    uncategorized: [
      ...list.uncategorized.filter((row) => row.id !== channelId),
      ...(removedCategory?.channels.map((row) => ({
        ...row,
        parentId: null,
      })) ?? []),
    ],
    categories: list.categories
      .filter((category) => category.id !== channelId)
      .map((category) => ({
        ...category,
        channels: category.channels.filter((row) => row.id !== channelId),
      })),
  }
}
