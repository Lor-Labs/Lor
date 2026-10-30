# Contributing to Lor

For a bug report, include what happened, what you expected, and the steps to
reproduce it. Remove credentials and private workspace content from logs and
screenshots. Discuss substantial features or architectural changes in an
issue before opening a pull request.

## Local development

Follow the [setup guide](reference/local-development.md). Read
[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) for repository conventions;
check for additional instructions in the app you're changing.

Keep changes focused. Shared UI and styles belong in `packages/ui`; use
relative imports in packages that export uncompiled TypeScript. Match the
existing Biome style: two spaces, double quotes, and no semicolons.

## Before opening a pull request

Run the static checks used by CI:

```sh
pnpm check
pnpm check-types
```

Explain the problem, the resulting behavior, and how you verified the change.
Include screenshots for visible UI changes when available, and call out any
new configuration or schema requirements. Restore local-only signup flag
changes before submitting. Keep credentials and generated build output out
of the pull request.
