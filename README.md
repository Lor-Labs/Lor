# Lor

**The AI multiplayer workspace for teams.**

Lor is a shared workspace where teams research, write, and build with AI.
Bring your tools and context into shared sessions, invite teammates, fork
ideas, and turn recurring work into Loops.

[Watch the walkthrough](https://media.lor.chat/lor-mvp-demo.mp4) ·
[Join the waitlist](https://lor.chat) ·
[Local setup](reference/local-development.md)

## What you can do

- **Work in shared sessions.** Bring a teammate into the conversation,
  mention them for feedback, or fork a session to explore another approach.
- **Connect your team's tools.** Bring in context from GitHub, Linear,
  Notion, and Attio. Conversations connect around the issues and documents
  they reference, preserving the reasoning behind the work.
- **Build and review together.** Work in a repository, inspect changes,
  run an app in a preview, and commit with your own GitHub account.
- **Put recurring work on a Loop.** Schedule research, reports, and other
  workflows, with approval controls for actions that need review.
- **Choose how you use AI.** Use Lor, connect your Claude subscription for
  Claude Code, or bring OpenAI and Anthropic API keys for Lor sessions.

## Project status

Lor is under active development. The hosted service is taking waitlist
signups, with beta invitations starting November 6, 2026. Joining the
waitlist does not grant immediate access.

You can run the source on your own infrastructure, but setup currently
requires external services and developer configuration. The local setup
guide is not a turnkey production deployment guide. DMs and voice channels
are currently hidden by launch flags; Codex sessions are disabled.

## Run locally

Use **Node.js 24**, **pnpm 9**, and **Docker Compose**. You'll also need
credentials for AI Gateway, S3-compatible storage, and Resend; agent execution
uses Blaxel sandboxes.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Fill in .env and configure local signup using the setup guide below.
docker compose up -d postgres redis
pnpm db:push
pnpm --filter @repo/db exec tsx src/seeds/index.ts
pnpm dev api web realtime worker
```

Read the [local development guide](reference/local-development.md) before
starting: it covers credentials, the signup gate, sandbox setup, and service
URLs. The web app runs at `http://localhost:3000`.

## Development

Lor uses React and TypeScript, a Hono API, PostgreSQL with pgvector, Redis,
and a shared agent runtime in a pnpm/Turborepo monorepo. The main web client
uses Vite and TanStack Router; the marketing site uses Next.js. Desktop and
mobile clients live alongside them.

See the [repository map and commands](reference/local-development.md#repository-map),
[architecture conventions](CLAUDE.md), and [feature references](reference/README.md)
for implementation details.

## Contributing

Bug reports and focused improvements are welcome. Discuss substantial changes
in an issue first, and follow [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
conventions, and the lint and type checks used by CI.

## License

Lor is licensed under [GNU AGPL v3](LICENSE). Third-party components retain
their own licenses and notices where provided.
