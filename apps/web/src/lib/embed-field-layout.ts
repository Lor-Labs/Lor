type EmbedFieldLike = {
  value: string
  inline?: boolean
}

export function isEmbedFieldInline(field: EmbedFieldLike): boolean {
  if (field.inline !== undefined) return field.inline

  // Embeds stored before inline flags were preserved have no layout metadata.
  // Recover compact label/value pairs, but never squeeze code or multiline
  // content into a column.
  const value = field.value.trim()
  return value.length > 0 && value.length <= 80 && !/[\n\r]|```/.test(value)
}

export function groupEmbedFields<T extends EmbedFieldLike>(fields: T[]): T[][] {
  const rows: T[][] = []
  let inlineRow: T[] = []

  const flushInlineRow = () => {
    if (inlineRow.length > 0) rows.push(inlineRow)
    inlineRow = []
  }

  for (const field of fields) {
    if (!isEmbedFieldInline(field)) {
      flushInlineRow()
      rows.push([field])
      continue
    }

    inlineRow.push(field)
    if (inlineRow.length === 3) flushInlineRow()
  }

  flushInlineRow()
  return rows
}
