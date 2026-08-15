import type { SourceProvider } from "./types"

// BYO inbound webhooks. Content arrives by delivery (raw payload capped on the
// trigger_delivery row) rather than by live-fetch, so there is nothing to
// resolve here; the connection is verified by construction (we mint it).
export const webhookProvider: SourceProvider = {
  async fetchContent() {
    return null
  },

  async verifyConnection() {
    return { accountLabel: null }
  },
}
