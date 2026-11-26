# Granola connector

Built 2026-11-26, uncommitted. Lets agents query a team's Granola meetings and
hear about each new one through Granola's webhooks. It follows the listener
model in `agents-and-chats.md` (decisions 40 to 43): a meeting is stored for the
workspace, delivered to the agents that listen for it, and an agent says what
matters in a chat. Circleback comes after this lands (see the end).

Vendor facts are from Granola's docs, read 2026-11-26:
[API](https://docs.granola.ai/introduction),
[workspace keys](https://docs.granola.ai/help-center/sharing/integrations/granola-api),
[webhooks](https://docs.granola.ai/webhooks),
[create endpoint](https://docs.granola.ai/api-reference/create-webhook-endpoint).
Nothing here was run against a real Granola account.

## Decisions (Jacob, 2026-11-26)

1. **Granola before Circleback.** Its webhooks are registered through the API,
   so nobody pastes a URL or a secret.
2. **Workspace API key only.** A personal key reads its owner's private notes,
   and Lor shows connected items to the whole workspace (decision 22: no
   privacy promise). A workspace key covers the spaces a Granola admin allowed.
3. **Granola's own logo, in color** (its app icon: the spiral on its green).

## What Granola offers

- **API:** `https://public-api.granola.ai/v1`, Bearer key. Workspace keys are
  made by a Granola admin (Business or Enterprise) under Settings → Connectors
  → Workspace API keys, for all spaces or chosen ones. Read-only; only notes
  with an AI summary are returned. 25 requests in 5 s, then 5 per second.
- **Endpoints used:** `GET /notes?page_size=1` (key check), `GET
  /notes/{id}?include=transcript` (413 when the transcript is too big inline,
  then `GET /notes/{id}/transcript` pages of up to 100), `POST /notes/search`
  (titles and summaries), `POST /notes/transcripts/search` (what was said, with
  excerpts), `POST|GET|DELETE /webhook-endpoints`.
- **Webhooks:** Business and Enterprise. Events `note.generated` (first
  summary), `note.access_granted` (a note shared with the key later),
  `note.edited`. Deliveries carry only `event_id`, `event_type`, `note_id`,
  `occurred_at`. Standard Webhooks signing (`webhook-id`,
  `webhook-timestamp`, `webhook-signature` = `v1,<base64 HMAC-SHA256 of
  id.timestamp.body>`, key = base64 after `whsec_`). Retried for four days on
  408/429/5xx, then the endpoint is disabled and missed events are not
  replayed. A 404 or other 4xx is permanent. Public HTTPS URLs only.

## As built

**Connect** (`POST /workspaces/{slug}/integrations/granola/connect`,
`connectGranola` in `apps/api/src/routes/v1/integrations/handlers.ts`, the key
logic in `packages/lor/src/providers/granola.ts`):

1. The key is checked with one list call (`invalid_key`).
2. Lor registers its webhook with `scopes: ["workspace"]` and all three events.
   Granola accepts that scope only from a workspace key, so this is also the
   workspace-key check: a 400 or 403 is refused as `not_workspace_key`, a 404
   as `webhooks_unavailable`. Endpoints a previous connect pointed at the same
   URL are deleted first.
3. `externalId` is the key's SHA-256 (Granola has no workspace id endpoint). The
   key and the signing secret are stored encrypted (`apiKey`, `webhookId`,
   `webhookSecret` on `integration_connection`). Replacing a key deletes the
   old key's endpoint; disconnecting deletes the endpoint.
4. **Local development:** when `NEXT_PUBLIC_API_URL` is not public HTTPS the
   webhook (and with it the workspace-key check) is skipped, the key still
   connects, and the dialog says new-meeting events are off on this server.
   Use a tunnel to test events.

**Webhook receiver** (`apps/api/src/routes/v1/integrations/granola/index.ts`,
`POST /v1/integrations/granola/webhook/{externalId}`): verifies the signature
and a five-minute timestamp window, claims `webhook-id` in Redis, then:

- **Every event** queues a refetch of the meeting into `source` (kind
  `meeting`, key = lowercase note id), whether or not anyone listens.
- **`note.generated` and `note.access_granted`** are "Meeting notes ready"
  (`meeting_ready`) when a listener is on. A second Redis claim per meeting
  (30 days) keeps the two events from announcing one meeting twice. The note
  is fetched with up to 30,000 characters of transcript, and the delivery
  carries the attendees, Granola's notes and the transcript to the listening
  agents. An optional post uses the meeting card.
- A note Granola can't return yet (404) is skipped and its meeting claim
  released; any other failure answers 503 so Granola retries.

**Stored meeting** (`fetchGranolaSourceItem`): a metadata line (length, date,
who took the notes, attendees), Granola's summary, then the transcript as
speaker turns, up to 150,000 characters. A deleted or unreadable note is
tombstoned.

**Tools** (`packages/lor/src/granola.ts`, all read-only and on by default):

| Tool | What it does |
|---|---|
| `search_granola_meetings` | Keywords over titles and summaries, or over what was said (`inTranscript`, with excerpts and start times); `participant`, dates, paging |
| `get_granola_meeting` | Title, link, time, length, attendees, calendar event, folders, Granola's notes |
| `get_granola_transcript` | Speaker turns, from a start time, up to 60,000 characters |

Wired like any connector: catalog in `packages/connectors/src/tools.ts`,
touch kind `granola_note`, the prompt line `GRANOLA_PROMPT_LINE` and tool trail
labels in `packages/lor/src/index.ts`. Tools still come from the chat's tool
profile until tools move to the agent (step 4 of `agents-and-chats.md`).
Nothing is attachable from the composer (`SEARCHERS.granola` is null: search
results carry no meeting links).

**Meeting card:** Attio's recording card now serves both
(`isMeetingCard`, web and mobile): "Meeting notes", "Open in Granola", the
Granola green. Summary and follow-ups come from the same `enrichMeetingEmbed`
pass, now run for any embed with a `meeting`. When transcripts are turned off
for the API, Granola's notes stand in for the transcript on the card.

**Logo:** `packages/ui/src/lib/granola-logo.ts` holds the spiral from the
wordmark SVG on granola.ai on the brand green `#b2c248`;
`GranolaLogo` (web) and the mobile `ConnectorIcon` draw it in color.

## Rollout

- `pnpm db:push`: adds `granola` to `integration_provider` and `granola_note`
  to `touch_kind`. No data moves.
- Deploy API, worker and web together (the worker runs the source refetch).
  Mobile picks the card and icon up with the next `eas update`.
- No new env vars: it needs `INTEGRATION_ENCRYPTION_KEY`, and a public HTTPS
  `NEXT_PUBLIC_API_URL` for events.

## Not checked, and open

- **Not run against Granola.** No key was available: the connect flow, the
  workspace-key refusal (assumed to be a 400 or 403 for a personal key),
  signature checks on a real delivery and the 413 transcript path are all
  unverified. The list response (`webhook_endpoints[]`) matches the docs.
- **Missed events are not caught up.** If the endpoint is disabled after four
  days of failures, reconnecting registers a new one but does not backfill
  notes made in between. A backfill on connect (list notes since the last
  stored meeting) is the follow-up.
- **No backfill of older meetings** at connect. The tools reach them live;
  only new or edited ones are stored.
- **Folder filters** (`folder_ids`) are not offered; the key's spaces decide.

## Circleback, later

From the 2026-11-26 research: a REST API with `cb_` keys on every plan
(per account; `ownership=All` adds meetings shared with the key's owner),
an OAuth MCP server, and webhooks on Pro and up that are set up by hand in
Circleback (an automation step, which an admin can enable for the whole
workspace) and signed with `X-Signature` = hex HMAC-SHA256 of the body. The
payload carries the full meeting, so no refetch is needed. It would reuse
`meeting_ready`, the `meeting` source kind and the card; the new part is a
step on the connector page to paste Lor's URL into Circleback and the signing
secret back.
