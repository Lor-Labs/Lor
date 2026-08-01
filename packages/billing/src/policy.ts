const BILLABLE_TOOLS = new Set(["merlin.respond", "investigate_code"])

export function isBillableTool(tool: string): boolean {
  return BILLABLE_TOOLS.has(tool)
}

export function usageDebitKey(options: {
  billingKey?: string
  messageId?: string | null
  tool: string
}): string | null {
  if (!isBillableTool(options.tool) || !options.messageId) return null
  return options.billingKey
    ? `${options.messageId}:${options.tool}:${options.billingKey}`
    : `${options.messageId}:${options.tool}`
}
