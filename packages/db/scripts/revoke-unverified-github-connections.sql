-- One-time rollout step BEFORE reopening GitHub setup. Existing bindings have
-- no ownership proof; do not canonicalize aliases or choose a winning tenant.
BEGIN;
UPDATE integration_connection
SET status = 'revoked', updated_at = now()
WHERE provider = 'github';
COMMIT;
