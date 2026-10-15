import { redactLogPath } from "@repo/logger"
import { pinoLogger } from "hono-pino"
import { logger } from "@/lib/logger"

const isProd = process.env.NODE_ENV === "production"

export function pinoLoggerMiddleware() {
  return pinoLogger({
    pino: logger,
    http: {
      onResLevel: (c) => {
        if (c.res.status >= 500) return "error"
        if (c.res.status >= 400) return "warn"
        return "info"
      },
      // Reuse the exception so the handler and response produce one report.
      onResBindings: (c) => ({
        ...(isProd
          ? { res: { status: c.res.status, headers: c.res.headers } }
          : {}),
        err: c.error,
        route: c.req.routePath,
      }),
      // In dev: one-liner per request — `GET /v1/dms 200 (542ms)`.
      //   Status + method + path + responseTime is all you want while scanning
      //   the terminal; userId/requestId already ride on ALS context if a
      //   handler emits its own logs.
      // In prod: retain request fields, masking channel webhook credentials.
      ...(isProd
        ? {
            onReqBindings: (c) => ({
              req: {
                url: redactLogPath(c.req.path),
                method: c.req.method,
                headers: c.req.header(),
              },
            }),
          }
        : {
            onReqMessage: false,
            // Drop the default `req` blob (url/method/headers). They'd
            // otherwise persist on the request-scoped child logger and
            // show up on the response log too.
            onReqBindings: () => ({}),
            onResMessage: (c) =>
              `${c.req.method} ${redactLogPath(c.req.path)} ${c.res.status}`,
          }),
    },
  })
}
