import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { workspaceBetaTrial } from "./beta"

export const betaComputeResource = pgTable(
  "beta_compute_resource",
  {
    name: text("name").primaryKey(),
    trialId: uuid("trial_id")
      .notNull()
      .references(() => workspaceBetaTrial.id, { onDelete: "restrict" }),
    usedMilliseconds: bigint("used_milliseconds", { mode: "number" })
      .default(0)
      .notNull(),
    active: boolean("active").default(false).notNull(),
    meteredAt: timestamp("metered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAccessAt: timestamp("last_access_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Set only after preview revocation and process shutdown both succeed.
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (table) => [index("beta_compute_resource_trial_idx").on(table.trialId)]
)
