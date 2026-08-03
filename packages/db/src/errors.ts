// Postgres unique-constraint violation (SQLSTATE 23505), surfaced either
// directly or wrapped by the driver.
export function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code
  return code === "23505"
}
