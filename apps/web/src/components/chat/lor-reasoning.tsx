import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@repo/ui/components/nexus-ui/reasoning"
import { useEffect, useState } from "react"

interface LorReasoningProps {
  text: string
  // True while reasoning is still streaming and no answer has landed yet —
  // keeps the block open and shows a live "thinking" label. Collapses when done.
  active: boolean
}

// Lor's summarized extended-thinking, shown live while it thinks and left as
// a collapsible "thought process" once the answer lands.
export function LorReasoning({ text, active }: LorReasoningProps) {
  // Nexus derives its label from whether it has *observed* a stream, so a
  // segment restored from history (which never streams in this session) would
  // read "Thinking..." forever. Track whether this instance ever streamed and
  // supply a settled label when it didn't; live segments keep Nexus's
  // "Thinking..." → "Thought for N seconds" progression.
  const [everStreamed, setEverStreamed] = useState(active)
  useEffect(() => {
    if (active) setEverStreamed(true)
  }, [active])

  return (
    <Reasoning className="mb-2" isStreaming={active}>
      <ReasoningTrigger>
        {everStreamed ? undefined : "Thought process"}
      </ReasoningTrigger>
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  )
}
