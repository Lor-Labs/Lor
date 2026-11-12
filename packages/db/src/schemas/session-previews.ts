import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentSession } from "./agent-sessions"
import { user } from "./users"

// Preview links for a code session's browser
// (reference/planned/sandbox-browser-runbook.md §8): a URL outside the app
// that opens the session's live browser for stakeholders. `private`: people
// in the session's workspace, signed in. `public`: anyone watches; a signed-in
// Lor account points and annotates. One link per session; deleting the row
// revokes it.
export const sessionPreviewAccessEnum = pgEnum("session_preview_access", [
  "private",
  "public",
])

export const sessionPreviewLink = pgTable(
  "session_preview_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    // The secret in the URL. Kept readable so the link can be copied again.
    token: text("token").notNull(),
    access: sessionPreviewAccessEnum("access").notNull().default("private"),
    expiresAt: timestamp("expires_at").notNull(),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("session_preview_link_sessionId_uidx").on(table.sessionId),
    uniqueIndex("session_preview_link_token_uidx").on(table.token),
  ]
)

// What an annotation is pinned to, as the page agent described it.
export type BrowserAnnotationElement = {
  selector: string
  tag: string
  role: string | null
  name: string | null
  text: string
  html: string
  url: string
  quote: string | null
}

// Annotations on the session browser's pages. The sandbox's gateway owns them
// while it runs; this copy outlives the sandbox, so notes a stakeholder left
// are still there after it is replaced. Screenshots stay in the sandbox.
export const sessionBrowserAnnotation = pgTable(
  "session_browser_annotation",
  {
    // The gateway's id for it.
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    authorId: uuid("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    color: text("color").notNull(),
    note: text("note").notNull(),
    element: jsonb("element").$type<BrowserAnnotationElement>().notNull(),
  },
  (table) => [
    index("session_browser_annotation_sessionId_idx").on(table.sessionId),
  ]
)
