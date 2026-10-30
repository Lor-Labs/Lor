# Lor marketing site

The site is waitlist-only. Both email forms submit through `/api/waitlist` to
the existing API and waitlist table. Set `NEXT_PUBLIC_API_URL` to the API base
URL in the www deployment. `/download` temporarily redirects to the waitlist.
Beta invitations start November 6, 2026; the site does not automatically open
signup on that date.

## Adding the walkthrough

In `app/lib/launch.ts`, set `DEMO_VIDEO.src` to a public, direct MP4 or WebM
URL (not a YouTube/Loom watch page). Optionally set `poster` to a cover image
URL and `captions` to an English WebVTT file. For cross-origin captions, the
video and caption host must allow cross-origin requests from the site.
Local assets in `public/` can also use root-relative paths.

Rebuild and deploy www after updating the config. The recording replaces the
illustrated workspace preview, and the hero link becomes “Watch the demo.”
Without a video URL, the labeled illustration stays visible; there is no
empty player. Playback uses native controls without autoplay.
