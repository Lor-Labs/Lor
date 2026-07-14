import type { ReactNode } from "react"
import { Text } from "react-native"

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.8px] text-muted">
      {children}
    </Text>
  )
}
