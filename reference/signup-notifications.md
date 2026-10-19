# Signup and waitlist notifications (LOR-105)

The API can post a notification to a Lor channel after a successful email signup.
The message contains the new user's name and email. It runs when the account is
created, before email verification, and includes invite signups. Sign-ins, failed
or duplicate signups, verification retries, and admin-created accounts do not
send notifications.

New waitlist entries also post to this channel. These use a rich embed with the
email address and the saved signup timestamp, labeled **New early-access signup**.
The website's `/api/waitlist` route forwards to the API's `POST /waitlist`; delivery
starts in the API only after the database inserts a new entry. Duplicate requests,
including concurrent requests for the same normalized email, do not post again.

## Setup

1. Open the destination channel's settings and create a webhook named `Signups`.
   For the hosted Lor deployment, use the Internal channel. Keep its Post effect
   enabled; Remember and Act are optional channel choices.
2. Copy the native webhook URL, without a `/slack` or `/discord` suffix.
3. Set `SIGNUP_WEBHOOK_URL` to that URL in the API service's private environment
   variables (Railway Variables for the hosted deployment), then redeploy the API.

Waitlist notifications reuse this setting and channel. No new environment
variable or webhook is needed. The API appends `/discord` to the native URL for
the waitlist embed; this is Lor's Discord-compatible payload format, not a request
to Discord.

The URL contains the webhook credential. Store it only in deployment secrets or
an untracked local `.env`; never in source, a `NEXT_PUBLIC_*` variable, or a PR.
The example environment file contains only an empty placeholder. There is no
hardcoded channel, workspace, hostname, or destination. Self-hosted installations
send nothing unless their operator configures a URL.

## Delivery

`packages/auth/src/lib/auth.ts` uses Better Auth's endpoint after hook, so the
signup handler finishes successfully before notification starts. It reads the
returned user rather than requiring a session, since email verification can
prevent a session from being created at signup.

The background request posts `{ "content": "…" }`, uses the webhook's configured
name and avatar, and times out after five seconds. User fields are bounded and
escaped for Markdown. Redirects are rejected. Passwords, auth tokens, and the
full signup request are never forwarded; logs include only the user ID and HTTP
status when available, never the webhook URL or response body.

Delivery is best effort: a failed request or API restart can lose a notification.
There are no automatic retries because the webhook endpoint does not deduplicate
deliveries. Failures log `Signup notification delivery failed` and never change
the signup result. Unset or blank `SIGNUP_WEBHOOK_URL` disables delivery.

Waitlist delivery uses the same five-second timeout, redirect policy, Markdown
escaping, and best-effort behavior. It logs only the waitlist entry ID and HTTP
status when available (`Waitlist notification delivery failed`). A delivery
failure never changes a saved waitlist entry or the successful API response.

Implementation reference: [Better Auth hooks](https://better-auth.com/docs/concepts/hooks).
