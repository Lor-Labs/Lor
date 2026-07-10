export const MIN_USERNAME_LENGTH = 3

export function hasValidUsername(username: string | null | undefined) {
  return !!username && username.length >= MIN_USERNAME_LENGTH
}
