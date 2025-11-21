-- Migration 0008: Add RPC Metadata Fields
-- Created: 2025-11-21
-- Purpose: Track consumer service and request flow for RPC integrations

-- Add RPC metadata columns
ALTER TABLE validations ADD COLUMN consumer TEXT;
ALTER TABLE validations ADD COLUMN flow TEXT;

-- Create indexes for filtering by consumer/flow
CREATE INDEX IF NOT EXISTS idx_validations_consumer ON validations(consumer);
CREATE INDEX IF NOT EXISTS idx_validations_flow ON validations(flow);
CREATE INDEX IF NOT EXISTS idx_validations_consumer_flow ON validations(consumer, flow);
