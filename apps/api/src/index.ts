import { serve } from "@hono/node-server"
import { env } from "@repo/env/server"
import app from "@/app"
import { installGithubCaches } from "@/lib/github-repo-cache"
import { logger } from "@/lib/logger"

installGithubCaches()

logger.info(`API server running on port ${env.PORT}`)
serve({ fetch: app.fetch, port: env.PORT })
