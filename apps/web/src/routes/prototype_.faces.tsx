import { createFileRoute, notFound } from "@tanstack/react-router"
import { FacesPrototype } from "@/components/prototype/faces/faces-prototype"

// Dev only: the pixel bestiary beside the simple faces try-out, to pick a
// style (reference/always-on-agents.md §13, Next, item 3).
export const Route = createFileRoute("/prototype_/faces")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: FacesPrototype,
})
