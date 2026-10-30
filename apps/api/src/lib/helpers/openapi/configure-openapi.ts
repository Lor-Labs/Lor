import { env } from "@repo/env/server"
import type { AppOpenAPI } from "@/lib/types/app-types"

export default function configureOpenAPI(app: AppOpenAPI) {
  // The spec maps every internal route; keep it out of production.
  if (env.NODE_ENV === "production") return
  app.doc("/docs", {
    openapi: "3.0.0",
    info: {
      version: "0.1.0",
      title: "Lor API",
    },
    servers: [
      {
        url: "http://localhost:8080",
        description: "Local server",
      },
    ],
  })
}
