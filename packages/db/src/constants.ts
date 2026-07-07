// Stable id for the global Merlin bot user (seeded in seeds/merlin.ts).
// Referenced across services without a lookup.
export const MERLIN_USER_ID = "00000000-0000-4000-8000-000000000001"

// Stable id for the shared app bot user that authors webhook and connector
// notification messages (seeded in seeds/app.ts). The displayed identity comes
// from the message's overrideName/overrideAvatarUrl, not this user.
export const APP_USER_ID = "00000000-0000-4000-8000-000000000002"
