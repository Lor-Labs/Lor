import { createFileRoute, notFound } from "@tanstack/react-router"
import { ChatsPrototype } from "@/components/prototype/chats/chats-prototype"

// Dev only: Lor as a group chat app with agents, where the team's own chat
// stays in Slack or Discord (reference/agents-and-chats.md), on made-up
// data, to judge the direction before it is built.
export const Route = createFileRoute("/prototype_/chats")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: ChatsPrototype,
})
