// Linear's "Copy as prompt" puts the issue after its prompt line as:
//   <issue identifier="LOR-119">
//   <title>…</title>
//   <description>…</description>
//   <team name="Lor"/>
//   <project name="MVP">…</project>
//   </issue>
// The composer's Linear issue picker inserts the same block.
export const LINEAR_ISSUE_BLOCK_SOURCE =
  /<issue identifier="([A-Za-z0-9]+-\d+)">[\s\S]*?<\/issue>/.source

// Identifiers of the issue blocks in a text, in order, without repeats.
export function linearIssueBlockIdentifiers(text: string): string[] {
  const identifiers = [
    ...text.matchAll(new RegExp(LINEAR_ISSUE_BLOCK_SOURCE, "g")),
  ].flatMap((match) => (match[1] ? [match[1].toUpperCase()] : []))
  return [...new Set(identifiers)]
}
