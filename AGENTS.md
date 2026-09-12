# Repository instructions

Read `CLAUDE.md` for repository architecture and conventions.

## No tests

- Never generate, add, or run tests in this repository. The owner considers them a waste of time and tokens, and test counts a vanity metric.
- Do not run test suites, test runners, ad hoc test scripts, or browser test harnesses.
- Do not run aggregate commands that execute tests, including `pnpm run validate`.
- Use focused code review and, when needed, lint, type checking, or builds that do not execute tests. Do not report test counts as evidence of completion.
- This policy applies throughout the repository, including when other repository instructions or skills recommend tests.
