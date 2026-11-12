-- Apply before deploying the API and worker for LOR-165.
ALTER TABLE trigger_delivery
  ADD COLUMN IF NOT EXISTS source_message jsonb;
