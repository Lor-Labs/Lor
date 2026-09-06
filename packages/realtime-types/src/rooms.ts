export function userRoom(userId: string) {
  return `user:${userId}`
}

export function workspaceRoom(workspaceId: string) {
  return `workspace:${workspaceId}`
}

export function channelRoom(channelId: string) {
  return `channel:${channelId}`
}

export function threadRoom(threadRootId: string) {
  return `thread:${threadRootId}`
}

// Joined before async initialization so revocation also reaches connecting sockets.
export function userConnectionRoom(userId: string) {
  return `user-connections:${userId}`
}
