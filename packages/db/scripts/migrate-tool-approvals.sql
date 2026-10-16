-- Pre-launch breaking change. Stop API/workers first. This removes connector
-- capability values and resets coarse approval rules; configure individual
-- tool rules before allowing agent runs again. No automatic policy conversion.
BEGIN;

LOCK TABLE agent_profile IN ACCESS EXCLUSIVE MODE;
UPDATE agent_profile
SET capabilities = ARRAY(
  SELECT value FROM unnest(capabilities) AS grants(value)
  WHERE value::text IN ('web', 'artifacts', 'custom_tools')
);

ALTER TABLE agent_profile ALTER COLUMN capabilities DROP DEFAULT;
CREATE TYPE lor_capability_individual_tools AS ENUM ('web', 'artifacts', 'custom_tools');
ALTER TABLE agent_profile ALTER COLUMN capabilities
  TYPE lor_capability_individual_tools[]
  USING capabilities::text[]::lor_capability_individual_tools[];
DROP TYPE lor_capability;
ALTER TYPE lor_capability_individual_tools RENAME TO lor_capability;
ALTER TABLE agent_profile ALTER COLUMN capabilities SET DEFAULT '{}';

DELETE FROM approval_policy
WHERE target ~ '^(capability|mcp_server):';

UPDATE approval
SET status = 'expired', resolved_at = now()
WHERE status = 'pending'
  AND (target ~ '^(capability|mcp_server):');

COMMIT;
