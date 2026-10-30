# Contributing to Lor

For a bug report, include what happened, what you expected, and the steps to
reproduce it. Remove credentials and private workspace content from logs and
screenshots. Discuss substantial features or architectural changes in an
issue before you open a pull request. Report security problems privately, as
[SECURITY.md](SECURITY.md) describes.

## Prerequisites

- Node.js 24 (`.node-version` and `engines` in `package.json`)
- pnpm 9 (`packageManager` in `package.json`)
- Bun, for `pnpm db:seed`
- Docker with Compose, for PostgreSQL and Redis

## Setup

```sh
pnpm install
cp .env.example .env    # fill in the values the README lists
docker compose up -d postgres redis
pnpm db:push && pnpm db:seed
pnpm dev
```

The [README](README.md#quickstart) lists the required values and external
services. The [local development guide](reference/local-development.md) has
more detail. To add an integration, follow
[reference/adding-a-connector.md](reference/adding-a-connector.md).

## Conventions

Read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) for repository
conventions, and check for more instructions in the app you change.

- Keep changes focused.
- Shared UI and styles belong in `packages/ui`.
- Packages that export uncompiled TypeScript use relative imports, not path
  aliases.
- Match the Biome style: two spaces, double quotes, no semicolons.

## Pull requests

1. Branch from `dev` and open the pull request against `dev`. `main` is the
   release branch.
2. Run the checks before you push:

   ```sh
   pnpm check
   pnpm check-types
   ```

   `pnpm check:fix` applies Biome fixes. Review the diff it makes.
3. Explain the problem, the new behavior, and how you verified the change.
   Add screenshots for visible UI changes. Name any new environment variable
   or schema change.

CI runs its own checks on each pull request. CodeRabbit also reviews pull
requests into `dev`. Keep credentials, generated build output, and local-only
changes (such as launch flags in `packages/utils/src/features.ts`) out of the
pull request.
