# The agent's computer, and which provider runs what

> Status: planned, not started. Decided with Jacob on 2026-11-24 after two
> days of provider research. Vendor facts were checked on the vendors' own
> pages on 2026-11-23 and 2026-11-24 unless a line says otherwise; check them
> again at the spike, because this market moves fast. Nothing here was tested
> live. It is the design behind "Next" item 1 in `always-on-agents.md` §13
> (decisions 25, 29, 36 and 43).

## What was decided (Jacob, 2026-11-24)

| What | Default | Fallback | Status |
|---|---|---|---|
| Coding sessions (Claude Code, Codex) | Boat | Blaxel | Blaxel is still first today. The move is in `boat-fallback.md`, "Direction" |
| The agent's computer | Picked by a spike on both | The other one | To build |
| iOS and Android testing | Expo Simulators, on the team's own Expo account | – | Nothing to build |
| A full Mac box | Namespace, NoMac as a cheaper trial | – | Only when someone asks |
| A shared channel drive | Blaxel Agent Drive | – | Wait: private preview, one region |
| A person's own computer, Lor's own servers | Another branch of the provider seam | – | Later |

Why not Blaxel for everything: it is the going rate for a managed sandbox
(E2B and Daytona cost the same at this size) and Boat is about nine times
cheaper per running hour. Lor charges 10 credits ($0.10) for an 8 GB
sandbox-hour (`SANDBOX_CREDITS_PER_GB_HOUR`, `beta-pricing-runbook.md`), so a
Blaxel hour loses about 23¢ and a Boat hour earns about 6¢.

Everything stays behind the provider seam (`packages/lor/src/sandbox/`,
`sandbox-ports.ts`), so the default is a setting, not a rewrite. That also
covers two risks: Baseten bought Blaxel on 2026-09-10 and has promised only
that "the product doesn't change", and Boat is a small, new company whose
size and funding were not verified.

## The agent's computer

What exists today is a browser on a screen, not a desktop
(`packages/lor/sandbox-image/browser/lor-browser-start`): Xvfb and openbox,
one Chromium stretched to fill the screen, the Selkies live view with its
watcher and controller roles, and `lor-browser`, which drives Chromium over
CDP and sees nothing else on the screen.

Design:

- **One computer per channel agent.** A tool starts it, never a turn
  (decision 29). The agent's loop stays in the worker; the computer is only
  its hands. Code still goes to sessions.
- **Its own image,** not the coding image, which came out at 3,549 MiB
  against the 3,000 MiB Blaxel says is known to boot. It needs a light
  desktop shell (a launcher, a file manager, a terminal), Chromium as a
  normal window beside other windows, and control of the whole screen for
  the agent (screenshots, mouse, keyboard). It reuses the display, the live
  view and take-over. Built for both providers, like the coding image
  (Dockerfile and `boat/setup.sh`).
- **Designed for files-only persistence.** The home folder and the browser
  profile live on durable storage that outlives the machine (a Blaxel
  volume; on Boat the kept disk plus a saved snapshot). Standby that keeps
  memory is a speed-up, never the only copy. This is what lets Boat, or a
  person's own computer, run it later with no redesign.
- **An install log** the agent appends to, so system packages can be
  replayed onto a new machine. Blaxel's named snapshots would do this
  better, but its docs call them a private preview, "not recommended for
  production use".
- **A spend cap per channel.** These agents wake themselves.

The spike, on Blaxel and on Boat, before any build:

1. Create one computer and sign in to a site.
2. Delete the machine, bring it back on the same storage, and check it is
   still signed in.
3. Measure a wake, and a month's cost at about 2 active hours a day.

If neither holds, try Daytona before building the desktop image: it has a
desktop and a screen-control API built in, the same compute price as Blaxel
and no plan fee. How it keeps state across sleep was not confirmed.

Open: location. Boat runs only in Germany, Finland and France, so a browser
acting for a US team gets pages in the wrong language and sign-ins flagged
as unfamiliar. If Boat adds a US region it wins both rows above.

## Provider facts

For a 2 vCPU / 4 GB computer. Hourly figures are worked out from each
vendor's listed rates.

| Provider | Running | Asleep | Memory kept asleep | Storage that outlives the machine | Desktop |
|---|---|---|---|---|---|
| Blaxel | $0.166/h | Snapshot storage, $0.20/GB-month | Yes, wakes in under 25 ms | Volumes ($0.12/GB-month), one per sandbox, attached at creation | Browser only today |
| Boat | $0.018/h | Free | No: processes end on stop | Disk kept at least 14 days; saved snapshots 10 per $20 of plan, then $0.056 a day | Browser only today |
| E2B | $0.166/h and a $150/month plan | Free | Yes, about 1 s to resume | None apart from the machine | Built in |
| Daytona | $0.166/h | Disk only | Not stated | Not checked | Built in (Linux, Windows) |
| Fly Sprites | Billed on use, up to about $0.165/h | About $0.02/GB-month | Not stated | 100 GB disk, checkpoints | Install your own |

- **Blaxel:** standby after about 15 s without a connection, kept
  "indefinitely". A deleted sandbox's own filesystem is gone; what a crash
  keeps is not documented. Tiers 0 and 1 enforce a maximum lifetime.
- **Boat:** a 4 vCPU / 8 GB box is $0.036/h. 100 running at once on the $20
  plan, 2,000 on the $2,000 plan. Limits measured in use are in
  `boat-fallback.md`.
- **Agent Drive (Blaxel):** a shared, replicated drive many sandboxes mount
  at once, attachable to a running sandbox, also readable as S3. Private
  preview, only in `us-was-1` (Lor pins `us-pdx-1`), no published price.
  Later use: one folder shared by the agent's computer and its sessions, and
  showing the agent's files without waking it. Not for the browser profile:
  many small files and databases that need file locking, which its docs
  don't cover (our judgment, not theirs).
- **Namespace:** Linux is $0.24/h for 4 vCPU / 8 GB, billed until a
  15-minute idle shutdown, files only after that. Devboxes are capped at 5
  a person and 50 a workspace, stopped ones included; its compute instances
  run 3 to 24 hours at most and are capped by vCPUs running at once. A
  devbox is a workstation for one developer; Lor needs a sandbox per
  session, so it fits only for Macs.
- **Macs:** Namespace $2.40 to $3.60/h by the minute, with VNC, Xcode and
  simulators, at most 12 to 48 macOS vCPUs at once by plan. NoMac $0.60 to
  $0.90/h by the minute, ready in about 30 s (its own page; a small, new
  company). AWS EC2 Mac $1.23/h with a 24-hour minimum, and a dedicated Mac
  mini is about $149 a month (third-party pages).
- **Expo Simulators** (launched 2026-11-12): cloud iOS simulators and
  Android emulators an agent drives from a Linux box, $0.10 a minute on
  Expo's paid plans, any framework, the project linked to an Expo account.
  For Lor's own mobile app: an `EXPO_TOKEN` in the repo's environment and
  the `development-simulator` profile already in `apps/mobile/eas.json`.
  Not tried.
- **Cua:** Cua Cloud ended on 2026-10-18. What remains is run on your own
  machines, which is where a "bring your own computer" branch would start.
- **Lor's own servers:** not now. Reports say Hetzner raised dedicated
  prices three to four times over in June 2026, and the trackers disagree
  on current prices. `beta-pricing-runbook.md` reconsiders it at about
  $10k a month of sandbox spend.

## Sources

- Blaxel: https://blaxel.ai/pricing,
  https://docs.blaxel.ai/Sandboxes/Overview,
  https://docs.blaxel.ai/Sandboxes/Volumes,
  https://docs.blaxel.ai/Sandboxes/Snapshots,
  https://docs.blaxel.ai/Sandboxes/best-practices,
  https://docs.blaxel.ai/Agent-drive/Overview
- Baseten and Blaxel:
  https://www.baseten.co/blog/blaxel-is-joining-baseten-to-build-the-future-of-agentic-cloud/
- Boat: https://docs.boat.dev/pricing, https://docs.boat.dev/limits,
  https://docs.boat.dev/faq
- E2B: https://e2b.dev/pricing, https://docs.e2b.dev/sandbox/persistence
- Daytona: https://www.daytona.io/pricing,
  https://www.daytona.io/docs/en/computer-use/
- Fly Sprites: https://fly.io/sprites
- Namespace: https://namespace.so/pricing, https://namespace.so/docs/devbox,
  https://namespace.so/docs/architecture/compute/macos
- Macs: https://nomac.app/, https://juuz.com/cloud/mac-cloud-pricing/,
  https://macyou.co/blog/aws-ec2-mac-pricing-explained
- Expo Simulators: https://docs.expo.dev/eas/simulators/introduction/,
  https://expo.dev/blog/introducing-expo-simulators-cloud-simulators-built-for-agents
- Cua: https://github.com/trycua/cua/pull/5488
- Hetzner: https://news.ycombinator.com/item?id=48542064
