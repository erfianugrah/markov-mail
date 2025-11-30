-- Add identity/geo/MX telemetry columns (2025-02-??)
-- Keeps the original reset migration intact while allowing existing D1 databases to evolve in-place.

ALTER TABLE validations ADD COLUMN identity_similarity REAL;
ALTER TABLE validations ADD COLUMN identity_token_overlap REAL;
ALTER TABLE validations ADD COLUMN identity_name_in_email INTEGER;

ALTER TABLE validations ADD COLUMN geo_language_mismatch INTEGER;
ALTER TABLE validations ADD COLUMN geo_timezone_mismatch INTEGER;
ALTER TABLE validations ADD COLUMN geo_anomaly_score REAL;

ALTER TABLE validations ADD COLUMN mx_has_records INTEGER;
ALTER TABLE validations ADD COLUMN mx_record_count INTEGER;
ALTER TABLE validations ADD COLUMN mx_primary_provider TEXT;
ALTER TABLE validations ADD COLUMN mx_provider_hits TEXT;
ALTER TABLE validations ADD COLUMN mx_lookup_failure TEXT;
ALTER TABLE validations ADD COLUMN mx_ttl INTEGER;
