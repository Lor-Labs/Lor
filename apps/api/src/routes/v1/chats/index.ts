import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/chats/handlers"
import * as routes from "@/routes/v1/chats/routes"

const chatsRouter = createRouter()
  .openapi(routes.listChats, handlers.listChats)
  .openapi(routes.updateChat, handlers.updateChat)

export default chatsRouter
