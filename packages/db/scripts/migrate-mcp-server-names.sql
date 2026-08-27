-- One-time, data-preserving rename for databases created before the MCP
-- server naming cleanup. Run this once per database before `pnpm db:push`.
--
-- Preconditions:
--   1. Take a database backup/snapshot.
--   2. Stop application processes that read or write MCP server tables.
--   3. Confirm this database has not already received the rename.
--
-- Railway SQL Console usage:
--   Select this entire file and run it as one batch. Railway automatically
--   wraps a multi-statement batch in a transaction.
--
-- psql usage:
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
--     -f packages/db/scripts/migrate-mcp-server-names.sql
--
-- Both execution methods make every statement transactional. A missing or
-- unexpected object aborts the batch, so a partially renamed schema cannot be
-- committed.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.tool_server') IS NULL THEN
    RAISE EXCEPTION 'Expected source table public.tool_server';
  END IF;

  IF to_regclass('public.agent_profile_tool_server') IS NULL THEN
    RAISE EXCEPTION 'Expected source table public.agent_profile_tool_server';
  END IF;

  IF to_regclass('public.mcp_server') IS NOT NULL THEN
    RAISE EXCEPTION 'Target table public.mcp_server already exists';
  END IF;

  IF to_regclass('public.agent_profile_mcp_server') IS NOT NULL THEN
    RAISE EXCEPTION 'Target table public.agent_profile_mcp_server already exists';
  END IF;

  IF to_regclass('public.tool_server_oauth_attempt') IS NOT NULL
    OR to_regclass('public.mcp_server_oauth_attempt') IS NOT NULL THEN
    RAISE EXCEPTION 'OAuth attempt table already exists; inspect this database before migrating';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname IN (
      'tool_server_auth_mode',
      'tool_server_oauth_status',
      'mcp_server_auth_mode',
      'mcp_server_oauth_status'
    )
  ) THEN
    RAISE EXCEPTION 'MCP server OAuth enum already exists; inspect this database before migrating';
  END IF;
END
$$;

LOCK TABLE
  public.tool_server,
  public.agent_profile_tool_server
IN ACCESS EXCLUSIVE MODE;

SELECT
  (SELECT count(*) FROM public.tool_server) AS before_server_rows,
  (SELECT count(*) FROM public.agent_profile_tool_server) AS before_grant_rows;

ALTER TABLE public.tool_server
  RENAME TO mcp_server;

ALTER TABLE public.agent_profile_tool_server
  RENAME TO agent_profile_mcp_server;

ALTER TABLE public.agent_profile_mcp_server
  RENAME COLUMN tool_server_id TO mcp_server_id;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_pkey TO mcp_server_pkey;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_workspace_id_workspace_id_fk
  TO mcp_server_workspace_id_workspace_id_fk;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_created_by_user_id_fk
  TO mcp_server_created_by_user_id_fk;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_id_not_null
  TO mcp_server_id_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_created_at_not_null
  TO mcp_server_created_at_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_updated_at_not_null
  TO mcp_server_updated_at_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_workspace_id_not_null
  TO mcp_server_workspace_id_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_name_not_null
  TO mcp_server_name_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_url_not_null
  TO mcp_server_url_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_headers_not_null
  TO mcp_server_headers_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_secrets_not_null
  TO mcp_server_secrets_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_enabled_tools_not_null
  TO mcp_server_enabled_tools_not_null;

ALTER TABLE public.mcp_server
  RENAME CONSTRAINT tool_server_description_not_null
  TO mcp_server_description_not_null;

ALTER TABLE public.agent_profile_mcp_server
  RENAME CONSTRAINT agent_profile_tool_server_profile_id_tool_server_id_pk
  TO agent_profile_mcp_server_profile_id_mcp_server_id_pk;

ALTER TABLE public.agent_profile_mcp_server
  RENAME CONSTRAINT agent_profile_tool_server_profile_id_agent_profile_id_fk
  TO agent_profile_mcp_server_profile_id_agent_profile_id_fk;

ALTER TABLE public.agent_profile_mcp_server
  RENAME CONSTRAINT agent_profile_tool_server_tool_server_id_tool_server_id_fk
  TO agent_profile_mcp_server_mcp_server_id_mcp_server_id_fk;

ALTER TABLE public.agent_profile_mcp_server
  RENAME CONSTRAINT agent_profile_tool_server_profile_id_not_null
  TO agent_profile_mcp_server_profile_id_not_null;

ALTER TABLE public.agent_profile_mcp_server
  RENAME CONSTRAINT agent_profile_tool_server_tool_server_id_not_null
  TO agent_profile_mcp_server_mcp_server_id_not_null;

ALTER INDEX public.tool_server_workspace_name_uidx
  RENAME TO mcp_server_workspace_name_uidx;

ALTER INDEX public.agent_profile_tool_server_server_idx
  RENAME TO agent_profile_mcp_server_lookup_idx;

SELECT
  (SELECT count(*) FROM public.mcp_server) AS after_server_rows,
  (SELECT count(*) FROM public.agent_profile_mcp_server) AS after_grant_rows,
  to_regclass('public.tool_server') AS legacy_server_table,
  to_regclass('public.agent_profile_tool_server') AS legacy_grant_table,
  to_regclass('public.mcp_server') AS current_server_table,
  to_regclass('public.agent_profile_mcp_server') AS current_grant_table;

-- After this succeeds, run `pnpm db:push`. Stop if Drizzle proposes deleting
-- or recreating either renamed table instead of adding the OAuth schema.
-- Confirm the before/after server and grant counts reported by this batch match.
