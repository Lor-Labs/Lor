# Lor

**The best place to get work done as a team.**

Lor is a team workspace for startups, for engineering and non-engineering
teams alike. Channel chat is for people talking to people. Lor, the AI agent,
works in sessions next to the chat. Tag a teammate into a session, and they
can pick up the work where it is.

[Watch the walkthrough](https://media.lor.chat/lor-mvp-demo.mp4) ·
[Join the waitlist](https://lor.chat) ·
[Local development guide](reference/local-development.md)

## How Lor works

- **A channel is a team chat plus a shared project.** The chat is for people.
  The project holds instructions, connectors, files, memory and sessions.
  Lor does not post in channel chat; a person can share a session result
  there.
- **Lor works in sessions.** A session is one piece of work with its own
  context and its own sandbox. Start a chat session for research, writing or
  analysis. Start a code session to work in one repository: review the
  changes, preview the app and commit with your own GitHub account.
- **Sessions are multiplayer.** Anyone who can see a session can type in it.
  Mention a teammate to bring them in. They read the history and continue the
  work. Fork a session to try another approach.
- **Lor knows your team's context.** Connect GitHub, Linear, Notion and
  Attio. Lor uses your workspace history and connected tools as context.
- **Put recurring work on a Loop.** Schedule research, reports and other
  runs, with approvals for actions that need review.
- **Choose the AI.** Use Lor's default models, run Claude Code on your own
  Claude subscription, or bring Anthropic and OpenAI API keys.

## Project status

Lor is under active development. The hosted service takes waitlist signups,
and beta invitations start November 6, 2026. Direct messages and voice
channels are hidden by launch flags in
[`packages/utils/src/features.ts`](packages/utils/src/features.ts). Codex
sessions are off.

## Self-hosting

Lor runs on your own machine, but it is not self-contained. Today it needs
these external services:

| Service | Use | Variables |
| --- | --- | --- |
| Vercel AI Gateway | All models and embeddings | `AI_GATEWAY_API_KEY` |
| Blaxel | The sandbox for every Lor run | `BL_API_KEY`, `BL_WORKSPACE` |
| S3-compatible storage | Uploads and files. Browsers upload straight to the bucket, so its CORS rules must allow the web app origin. | `S3_*` |
| Resend | Email delivery | `RESEND_API_KEY`, `EMAIL_FROM` |

These services are optional. Each feature is off when its variables are
unset.

| Service | Enables | Variables |
| --- | --- | --- |
| Autumn (payments through Stripe) | Billing and credits. Unset, all usage is free. | `AUTUMN_SECRET_KEY`, `AUTUMN_WEBHOOK_SECRET` |
| GitHub App | The GitHub connector, repositories and commits as yourself | `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` |
| Linear, Notion, Attio | Their connectors | `LINEAR_*`, `NOTION_*`, `ATTIO_*` |
| Exa | Web search and page fetch for Lor | `EXA_API_KEY` |
| code.storage | Code session checkpoints | `CODE_STORAGE_ORG`, `CODE_STORAGE_PRIVATE_KEY` |
| LiveKit, Deepgram | Voice channels (hidden by default) | `LIVEKIT_*`, `DEEPGRAM_API_KEY` |

The schemas in [`packages/env/src/server.ts`](packages/env/src/server.ts) and
[`server-fields.ts`](packages/env/src/server-fields.ts) are the full list.

### Sandbox image

Every Lor run uses a Blaxel sandbox. Publish the workbench image to your
Blaxel workspace before you start a session:

```sh
pnpm --filter @repo/lor exec tsx sandbox-image/harness-bootstrap.ts
cd packages/lor/sandbox-image
bl push
```

Run `bl push` from `packages/lor/sandbox-image`, not from the repository
root. The `bl` CLI loads the `.env` file it finds and can print it when
parsing fails. Set `LOR_WORKBENCH_IMAGE` if your image reference is not
`sandbox/workbench:latest`.

## Quickstart

Install **Node.js 24**, **pnpm 9**, **Bun** (`pnpm db:seed` runs on Bun) and
**Docker** with Compose.

```sh
pnpm install
cp .env.example .env    # then fill in the values below
docker compose up -d postgres redis
pnpm db:push && pnpm db:seed
pnpm dev
```

Set these values in `.env` before you start Docker Compose:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Separate random passwords for Compose: `openssl rand -hex 32` |
| `DATABASE_URL` | `postgresql://lor:<POSTGRES_PASSWORD>@localhost:5432/lor` |
| `REDIS_URL` | `redis://:<REDIS_PASSWORD>@localhost:6379` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `INTEGRATION_ENCRYPTION_KEY` | `openssl rand -hex 32`. It encrypts connector tokens and API keys. |
| `AI_GATEWAY_API_KEY` | Your Vercel AI Gateway key |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` |
| `NEXT_PUBLIC_REALTIME_URL` | `http://localhost:8000` |
| `NODE_ENV` | `development` (the default is `production`) |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_PUBLIC_URL` | Your bucket |
| `NEXT_PUBLIC_S3_PUBLIC_URL` | The same value as `S3_PUBLIC_URL` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Your Resend key and a sender on your verified domain |
| `BL_API_KEY`, `BL_WORKSPACE` | Your Blaxel API key and workspace. Set both. |

`pnpm db:push` creates the database extensions and schema. `pnpm db:seed`
creates Lor's bot users. `pnpm dev` opens a picker for the apps to run;
`pnpm dev --all` skips the picker and runs everything except desktop and
mobile. Open the web app at http://localhost:3000.

On a fresh install, the first account can sign up without an invitation.
Later accounts need an email invitation from a workspace admin. With
`NODE_ENV=development`, the API also logs verification and password reset
links, so you can verify an account before your Resend domain works.

`docker-compose.yml` can also build and run the API, realtime, worker and web
images, which read `.env`. Use it as a starting point, not as a production
deployment guide. The [local development guide](reference/local-development.md)
has more detail on ports, connectors and sandboxes.

## Project structure

This is a pnpm + Turborepo monorepo:

```
apps/
  web/          — Main web app (Vite + React + TanStack Router)
  www/          — Marketing site and waitlist (Next.js)
  api/          — Hono API server
  realtime/     — Socket.IO realtime gateway
  worker/       — Background jobs
  desktop/      — Desktop client (Tauri)
  mobile/       — Mobile client (Expo)
  transcriber/  — Speech-to-text service for voice channels

packages/
  api-client/   — Shared type-safe Hono API client
  auth/         — Better Auth configuration and helpers
  ui/           — Shared shadcn/ui component library
  db/           — Drizzle ORM schema and database client
  env/          — Type-safe environment variables (server/client)
  utils/        — Shared utility helpers and launch flags
  billing/      — Credits and billing logic
  connectors/   — Integration connector registry
  logger/       — Shared logging helpers
  lor/          — Lor agent runtime
  messaging/    — Message and channel domain logic
  realtime-types/ — Shared realtime event types
  voice/        — Voice channel support
  typescript-config/ — Shared TypeScript configs
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Pick the apps to run in development mode (`--all` runs all but desktop and mobile) |
| `pnpm build` | Build all apps and packages |
| `pnpm check` | Run Biome lint and format checks |
| `pnpm check:fix` | Apply Biome fixes |
| `pnpm check-types` | Run TypeScript type checks across the workspace |
| `pnpm db:push` | Apply the Drizzle schema to the database |
| `pnpm db:seed` | Create Lor's bot users (needs Bun) |
| `pnpm db:studio` | Open Drizzle Studio |

## Contributing

Bug reports and focused improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request. Report
security problems privately, as [SECURITY.md](SECURITY.md) describes.

## License

Lor is licensed under the [GNU Affero General Public License v3.0](LICENSE).
The bundled fonts use the SIL Open Font License 1.1; see the `OFL.txt` file
next to them. Third-party components keep their own licenses.
