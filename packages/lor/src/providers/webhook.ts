import type { SourceProvider } from "./types"

// BYO inbound webhooks. Never ingested: the posted message is the record, and
// the raw payload is capped on the trigger_delivery row. The connection is
// verified by construction (we mint it).
export const webhookProvider: SourceProvider = {
  async verifyConnection() {
    return { accountLabel: null }
  },
}
