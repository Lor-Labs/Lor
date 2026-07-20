export const MIN_USERNAME_LENGTH = 3
export const MAX_USERNAME_LENGTH = 30
export const USERNAME_REGEX = /^[a-zA-Z0-9_.]+$/

export function hasValidUsername(username: string | null | undefined) {
  return !!username && username.length >= MIN_USERNAME_LENGTH
}
