-- ============================================================================
-- Markov Mail Complete Database Schema
-- ============================================================================
-- This is a consolidated schema that includes all migrations up to 0008
-- For NEW deployments, use this file to initialize the database
-- For EXISTING deployments, use migrations in migrations/ directory
-- ============================================================================
-- Version: 2.5.1
-- Last Updated: 2025-11-27
-- Migrations Included: 0001-0008
-- ============================================================================

-- ============================================================================
-- Validation Metrics Table
-- Stores all email validation events with detailed fraud detection data
-- ============================================================================
CREATE TABLE IF NOT EXISTS validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Decision & Risk
    decision TEXT NOT NULL CHECK(decision IN ('allow', 'warn', 'block')),
    risk_score REAL NOT NULL CHECK(risk_score >= 0 AND risk_score <= 1),
    block_reason TEXT,

    -- Email Analysis
    email_local_part TEXT,
    domain TEXT,
    tld TEXT,
    fingerprint_hash TEXT NOT NULL,

    -- Pattern Detection
    pattern_type TEXT,
    pattern_family TEXT,
    is_disposable INTEGER DEFAULT 0, -- 0=false, 1=true (SQLite boolean)
    is_free_provider INTEGER DEFAULT 0,
    has_plus_addressing INTEGER DEFAULT 0,
    has_keyboard_walk INTEGER DEFAULT 0, -- DEPRECATED (v2.2.0): Always 0, replaced by Markov detection
    is_gibberish INTEGER DEFAULT 0,      -- DEPRECATED (v2.2.0): Always 0, replaced by Markov detection

    -- Scores
    entropy_score REAL,
    bot_score REAL,
    tld_risk_score REAL,
    domain_reputation_score REAL,
    pattern_confidence REAL,

    -- Markov Chain Analysis (Phase 7)
    markov_detected INTEGER DEFAULT 0,
    markov_confidence REAL,
    markov_cross_entropy_legit REAL,
    markov_cross_entropy_fraud REAL,

    -- Ensemble Metadata (v2.3+) - Migration 0004
    ensemble_reasoning TEXT,
    model_2gram_prediction TEXT CHECK(model_2gram_prediction IN ('fraud', 'legit', NULL)),
    model_3gram_prediction TEXT CHECK(model_3gram_prediction IN ('fraud', 'legit', NULL)),

    -- OOD Detection (v2.4+) - Migration 0005
    min_entropy REAL,              -- min(H_legit, H_fraud) - abnormality measure
    abnormality_score REAL,        -- How far above OOD threshold
    abnormality_risk REAL,         -- Risk contribution from abnormality (0.0-0.6)
    ood_detected INTEGER DEFAULT 0,

    -- OOD Zone Tracking (v2.4.1+) - Migration 0006
    ood_zone TEXT,                 -- 'none' (<3.8 nats), 'warn' (3.8-5.5), 'block' (5.5+)

    -- Online Learning & A/B Testing (Phase 8)
    client_ip TEXT,
    user_agent TEXT,
    model_version TEXT,
    exclude_from_training INTEGER DEFAULT 0,
    ip_reputation_score REAL,

    -- A/B Testing
    experiment_id TEXT,
    variant TEXT CHECK(variant IN ('control', 'treatment', NULL)),
    bucket INTEGER CHECK(bucket >= 0 AND bucket <= 99 OR bucket IS NULL),

    -- Geographic & Network (Basic)
    country TEXT,
    asn INTEGER,

    -- Performance
    latency REAL NOT NULL,

    -- Algorithm Versioning (v2.1+) - Migration 0002
    pattern_classification_version TEXT,

    -- Enhanced Request Metadata (v2.5+) - Migration 0007
    -- Geographic (Enhanced)
    region TEXT,
    city TEXT,
    postal_code TEXT,
    timezone TEXT,
    latitude TEXT,
    longitude TEXT,
    continent TEXT,
    is_eu_country TEXT,

    -- Network (Enhanced)
    as_organization TEXT,
    colo TEXT,
    http_protocol TEXT,
    tls_version TEXT,
    tls_cipher TEXT,

    -- Bot Detection (Enhanced)
    client_trust_score INTEGER,
    verified_bot INTEGER DEFAULT 0,
    js_detection_passed INTEGER DEFAULT 0,
    detection_ids TEXT, -- JSON array

    -- Fingerprints (Enhanced)
    ja3_hash TEXT,
    ja4 TEXT,
    ja4_signals TEXT, -- JSON object

    -- RPC Metadata (Migration 0008)
    consumer TEXT,
    flow TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_validations_timestamp ON validations(timestamp);
CREATE INDEX IF NOT EXISTS idx_validations_decision ON validations(decision);
CREATE INDEX IF NOT EXISTS idx_validations_fingerprint ON validations(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_validations_risk_score ON validations(risk_score);
CREATE INDEX IF NOT EXISTS idx_validations_country ON validations(country);
CREATE INDEX IF NOT EXISTS idx_validations_domain ON validations(domain);
CREATE INDEX IF NOT EXISTS idx_validations_experiment ON validations(experiment_id, variant) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_validations_block_reason ON validations(block_reason) WHERE decision = 'block';

-- Pattern versioning index (Migration 0002)
CREATE INDEX IF NOT EXISTS idx_validations_pattern_version ON validations(pattern_classification_version);

-- Ensemble metadata index (Migration 0004)
CREATE INDEX IF NOT EXISTS idx_validations_ensemble_reasoning ON validations(ensemble_reasoning) WHERE ensemble_reasoning IS NOT NULL;

-- OOD detection indexes (Migration 0005)
CREATE INDEX IF NOT EXISTS idx_validations_ood_detected ON validations(ood_detected, min_entropy) WHERE ood_detected = 1;
CREATE INDEX IF NOT EXISTS idx_validations_abnormality_risk ON validations(abnormality_risk) WHERE abnormality_risk > 0;

-- OOD zone indexes (Migration 0006)
CREATE INDEX IF NOT EXISTS idx_validations_ood_zone ON validations(ood_zone) WHERE ood_zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_validations_ood_zone_decision ON validations(ood_zone, decision, timestamp) WHERE ood_zone IS NOT NULL;

-- Enhanced metadata indexes (Migration 0007)
CREATE INDEX IF NOT EXISTS idx_validations_region ON validations(region);
CREATE INDEX IF NOT EXISTS idx_validations_city ON validations(city);
CREATE INDEX IF NOT EXISTS idx_validations_colo ON validations(colo);
CREATE INDEX IF NOT EXISTS idx_validations_ja3_hash ON validations(ja3_hash);
CREATE INDEX IF NOT EXISTS idx_validations_ja4 ON validations(ja4);
CREATE INDEX IF NOT EXISTS idx_validations_verified_bot ON validations(verified_bot);
CREATE INDEX IF NOT EXISTS idx_validations_client_trust_score ON validations(client_trust_score);

-- RPC metadata indexes (Migration 0008)
CREATE INDEX IF NOT EXISTS idx_validations_consumer ON validations(consumer);
CREATE INDEX IF NOT EXISTS idx_validations_flow ON validations(flow);
CREATE INDEX IF NOT EXISTS idx_validations_consumer_flow ON validations(consumer, flow);

-- ============================================================================
-- Training Metrics Table
-- Tracks model training pipeline events and performance
-- ============================================================================
CREATE TABLE IF NOT EXISTS training_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Event Type
    event TEXT NOT NULL CHECK(event IN (
        'training_started', 'training_completed', 'training_failed',
        'validation_passed', 'validation_failed', 'lock_acquired',
        'lock_failed', 'anomaly_detected', 'candidate_created'
    )),

    -- Metadata
    model_version TEXT,
    trigger_type TEXT CHECK(trigger_type IN ('scheduled', 'manual', 'online', NULL)),

    -- Training Data Counts
    fraud_count INTEGER,
    legit_count INTEGER,
    total_samples INTEGER,
    training_duration REAL,

    -- Validation Metrics
    accuracy REAL,
    precision_metric REAL, -- renamed from 'precision' (SQLite reserved word)
    recall REAL,
    f1_score REAL,
    false_positive_rate REAL,

    -- Anomaly Detection
    anomaly_score REAL,
    anomaly_type TEXT,

    -- Error Context
    error_message TEXT,
    error_type TEXT
);

-- Indexes for training queries
CREATE INDEX IF NOT EXISTS idx_training_timestamp ON training_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_training_event ON training_metrics(event);
CREATE INDEX IF NOT EXISTS idx_training_model_version ON training_metrics(model_version);

-- ============================================================================
-- A/B Test Metrics Table
-- Tracks A/B experiments and model promotion decisions
-- ============================================================================
CREATE TABLE IF NOT EXISTS ab_test_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Event Type
    event TEXT NOT NULL CHECK(event IN (
        'experiment_created', 'experiment_stopped',
        'variant_assigned', 'promotion_evaluated',
        'model_promoted', 'canary_rollback'
    )),

    -- Experiment Details
    experiment_id TEXT,
    variant TEXT CHECK(variant IN ('control', 'treatment', 'none', NULL)),
    bucket INTEGER,

    -- Traffic Configuration
    control_percent REAL,
    treatment_percent REAL,

    -- Results
    control_samples INTEGER,
    treatment_samples INTEGER,
    p_value REAL,
    improvement REAL,

    -- Decision Context
    reason TEXT,
    promotion_decision TEXT CHECK(promotion_decision IN ('promote', 'rollback', 'extend', 'none', NULL))
);

-- Indexes for A/B test queries
CREATE INDEX IF NOT EXISTS idx_ab_test_timestamp ON ab_test_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_ab_test_experiment ON ab_test_metrics(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_event ON ab_test_metrics(event);

-- ============================================================================
-- Admin Metrics Table
-- Tracks administrative actions and configuration changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Event Type
    event TEXT NOT NULL CHECK(event IN (
        'config_updated', 'weights_changed',
        'feature_toggled', 'manual_training_triggered',
        'model_deployed', 'whitelist_updated'
    )),

    -- Admin Context
    admin_hash TEXT, -- Hashed admin identifier for privacy
    config_key TEXT,
    old_value TEXT,
    new_value TEXT,

    -- Action Context
    reason TEXT,
    validation_passed INTEGER DEFAULT 0
);

-- Indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_admin_timestamp ON admin_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_admin_event ON admin_metrics(event);
CREATE INDEX IF NOT EXISTS idx_admin_config_key ON admin_metrics(config_key);

-- ============================================================================
-- Schema Information
-- ============================================================================
-- This schema represents the complete state after applying all migrations:
-- - Migration 0001: Initial schema (base tables)
-- - Migration 0002: Added pattern_classification_version
-- - Migration 0003: Deprecated heuristic detectors (no schema changes)
-- - Migration 0004: Added ensemble metadata (ensemble_reasoning, model predictions)
-- - Migration 0005: Added OOD detection (min_entropy, abnormality metrics)
-- - Migration 0006: Added OOD zone tracking (ood_zone column)
-- - Migration 0007: Added enhanced request.cf metadata (geographic, network, bot detection)
-- - Migration 0008: Added RPC metadata (consumer, flow columns and indexes)
--
-- For NEW deployments:
--   wrangler d1 execute DB --file=./schema.sql --remote
--
-- For EXISTING deployments (with data):
--   wrangler d1 migrations apply DB --remote
-- ============================================================================
