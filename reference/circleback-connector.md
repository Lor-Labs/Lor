# Circleback connector

Built 2026-11-27, uncommitted. Lets agents query a team's Circleback meetings
and action items, and hear about each new meeting through a Circleback
automation's webhook. It reuses what the Granola connector added
(`granola-connector.md`): the `meeting_ready` event, `meeting` sources, the
meeting card and listeners with suggestions on the connector page
(`agents-and-chats.md`, decisions 40 to 43).

Vendor facts are from Circleback's docs and OpenAPI spec
(`https://circleback.ai/docs/api/openapi.json`), read 2026-11-27. Nothing here
was run against a real Circleback account.

## Decisions (Jacob, 2026-11-26)

1. **A read-only API key,** not OAuth through Circleback's MCP server.
2. **No paid seat.** The dialog asks for any member's key. (A Business viewer
   seat is free and sees only what is shared with it, but whether a viewer can
   make an API key is unconfirmed, so it is not suggested.)
3. **Private meetings are left to the automation's conditions** (for example
   leaving out meetings tagged 1:1). Lor adds no rule of its own.
4. **An action items tool is included.**

## What Circleback offers

- **API:** `https://circleback.ai/api`, Bearer `cb_` keys from Settings → API
  access (`https://circleback.ai/settings?tab=api-access`), read-only or
  read-and-write, on every plan (Free reaches 30 days). A key acts as one
  person. Paging is a `Link: <…>; rel="next"` header. Limits per account:
  Free 20 a minute, paid 300.
- **Endpoints used:** `GET /oauth/test` (the key's account email; the key
  check), `GET /search?searchTerm=` (the key owner's meetings by name, notes
  and transcript), `GET /meetings?ownership=All` (theirs and those shared
  with them), `GET /meeting/{id}`, `GET /meeting/{id}/transcript`
  (`[{ speaker, text, timestamp }]`, seconds), `GET /action-items?assigneeType=`
  (`Me`, `MyWorkspace`, `OutsideMyWorkspace`, `Unassigned`, `Anyone`).
- **Webhooks:** Pro and up, only as a "Send webhook request" step in an
  automation, set up by hand; the API cannot create one. A Circleback admin can
  share an automation with the workspace and turn on "Enable this automation
  for people added", so it runs on everyone's meetings. Each step has its own
  signing secret: `X-Signature` = hex HMAC-SHA256 of the raw body. Retried up
  to 9 more times on a non-2xx or no answer in 5 minutes. The payload is the
  whole meeting (`id`, `name`, `createdAt`, `duration` in seconds, `attendees`,
  `notes`, `actionItems`, `transcript`, `insights`, `tags`, a `recordingUrl`
  valid for 24 hours).

## As built

**Connect** (`POST /workspaces/{slug}/integrations/circleback/connect`): the
key is checked with `GET /oauth/test`; `externalId` is its SHA-256 and the
connected account is shown by its email. A new key drops the old
connection's signing secret, since that secret belongs to an automation step
pointing at the old connection's URL.

**The webhook setup step** (`circleback-webhook-setup.tsx`, "New meetings" on
the connector page, managers only): Lor's URL
(`/v1/integrations/circleback/webhook/{connectionId}`) with Copy and a link to
Circleback's automations, a field for the step's signing secret
(`PUT …/integrations/circleback/webhook-secret`, stored encrypted in
`webhook_secret`), and a status: "Not set up yet", "Waiting for the first
meeting", or when the last meeting came in (`webhook_received_at`, a new
column on `integration_connection`). `listIntegrations` returns these as
`inboundWebhook`.

**Receiver** (`apps/api/src/routes/v1/integrations/circleback/index.ts`):
looks up the connection by id, refuses a delivery before a secret is saved,
checks the signature, records `webhook_received_at`, then:

- **Stores the meeting from the payload** (`storeSourceItem`, kind `meeting`,
  key = the meeting id): metadata line, notes, action items, transcript. Not
  refetched: a workspace automation sends meetings the key may not reach. A
  storage failure answers 503 so Circleback retries. The recording link is not
  kept.
- **"Meeting notes ready"** when a listener is on, once per meeting (a Redis
  claim per meeting for 30 days; Circleback's retries and test requests send
  the same meeting again). The delivery carries the attendees, notes, action
  items and up to 30,000 characters of transcript; an optional post uses the
  meeting card.

**Tools** (`packages/lor/src/circleback.ts`, all read-only, on by default):

| Tool | What it does |
|---|---|
| `search_circleback_meetings` | A keyword over names, notes and transcripts (`/search`), or recent meetings between dates (`/meetings?ownership=All`) |
| `get_circleback_meeting` | Title, link, time, length, attendees with titles and companies, tags, notes, action items |
| `get_circleback_transcript` | Speaker turns with their time into the meeting, from `fromSeconds`, up to 60,000 characters |
| `list_circleback_action_items` | By owner (`me`, `workspace`, `outside`, `unassigned`, `anyone`) and status |

Wired like Granola: catalog in `packages/connectors/src/tools.ts`, touch kind
`circleback_meeting`, `CIRCLEBACK_PROMPT_LINE` and trail labels in
`packages/lor/src/index.ts`. The prompt line tells the agent that stored
meetings from the automation can reach further than the tools.

**Card and logo:** the shared meeting card gains Circleback ("Open in
Circleback", its orange). The logo is Circleback's own manifest icon
(`/logos/circleback_square.png`, the orange c and blue dot on a transparent
background) at 128 px, inlined in `packages/ui/src/lib/circleback-logo.ts`.

## Rollout

- `pnpm db:push`: adds `circleback` to `integration_provider`,
  `circleback_meeting` to `touch_kind`, and `integration_connection.webhook_received_at`.
  No data moves.
- Deploy API, worker and web together; mobile with the next `eas update`.
- No new env vars. Events need a public `NEXT_PUBLIC_API_URL` that Circleback
  can reach.

## How it was checked

On a throwaway copy of the dev database with this branch's schema pushed:

- A made-up key was refused by Circleback's real `GET /oauth/test` (401) and
  the dialog showed the message.
- With a stand-in connection: the secret saved, the status went from "Not set
  up yet" to "Waiting for the first meeting"; a delivery signed with the wrong
  secret got 401; a correctly signed one (shaped like the documented payload)
  was stored with its chunks embedded, and the status showed when it arrived.
- With a listener posting to a chat, the same meeting sent twice posted one
  card, which showed "Meeting notes", "Open in Circleback", the summary and
  three follow-ups.

## Not checked, and open

- **Not run with a real Circleback account.** A real key, a real automation
  delivery (its exact signature encoding) and the `Link` paging are from the
  docs only; the tools have not called Circleback with a valid key.
- **Search may only cover the key owner's own meetings** (the docs say "the
  authenticated user's meetings" and it has no `ownership` parameter). Stored
  meetings from the automation cover the rest through Lor's own search.
- **No backfill** of meetings from before the automation was set up. People
  can send past meetings to the automation from Circleback's Actions menu.
- **One automation per connection:** the URL and secret are per connection,
  so a second automation needs the same secret, which Circleback does not
  allow. One workspace-wide automation is the intended setup.
