import { createContext, type ReactNode, useContext } from "react"
import { createPortal } from "react-dom"

// A row of tabs above the main area's card, like Linear's. The layout owns
// the slot; a page renders its tab bar into it (a code session's file and
// diff tabs).
export const MainAreaTabsSlot = createContext<HTMLElement | null>(null)

export function MainAreaTabs({ children }: { children: ReactNode }) {
  const slot = useContext(MainAreaTabsSlot)
  return slot ? createPortal(children, slot) : null
}
