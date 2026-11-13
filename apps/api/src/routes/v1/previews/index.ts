import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/previews/handlers"
import * as routes from "@/routes/v1/previews/routes"

const previewsRouter = createRouter()
  .openapi(routes.getPreview, handlers.getPreview)
  .openapi(routes.openPreviewView, handlers.openPreviewView)
  .openapi(routes.markPreviewSeen, handlers.markPreviewSeen)

export default previewsRouter
