-- Decision-tree reset schema

CREATE TABLE IF NOT EXISTS validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,

    decision TEXT NOT NULL CHECK(decision IN ('allow', 'warn', 'block')),
    risk_score REAL NOT NULL CHECK(risk_score >= 0 AND risk_score <= 1),
    block_reason TEXT,

    email_local_part TEXT,
    domain TEXT,
    tld TEXT,
    fingerprint_hash TEXT NOT NULL,

    pattern_type TEXT,
    pattern_family TEXT,
    pattern_confidence REAL,
    is_disposable INTEGER DEFAULT 0,
    is_free_provider INTEGER DEFAULT 0,
    has_plus_addressing INTEGER DEFAULT 0,

    entropy_score REAL,
    bot_score REAL,
    tld_risk_score REAL,
    domain_reputation_score REAL,

    decision_tree_reason TEXT,
    decision_tree_path TEXT,

    client_ip TEXT,
    user_agent TEXT,
    model_version TEXT,
    ip_reputation_score REAL,
    consumer TEXT,
    flow TEXT,

    experiment_id TEXT,
    variant TEXT CHECK(variant IN ('control', 'treatment', NULL)),
    bucket INTEGER,

    country TEXT,
    asn INTEGER,
    region TEXT,
    city TEXT,
    postal_code TEXT,
    timezone TEXT,
    latitude TEXT,
    longitude TEXT,
    continent TEXT,
    is_eu_country TEXT,
    as_organization TEXT,
    colo TEXT,
    http_protocol TEXT,
    tls_version TEXT,
    tls_cipher TEXT,

    client_trust_score INTEGER,
    verified_bot INTEGER DEFAULT 0,
    js_detection_passed INTEGER DEFAULT 0,
    detection_ids TEXT,
    ja3_hash TEXT,
    ja4 TEXT,
    ja4_signals TEXT,

    pattern_classification_version TEXT,
    latency REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validations_timestamp ON validations(timestamp);
CREATE INDEX IF NOT EXISTS idx_validations_decision ON validations(decision);
CREATE INDEX IF NOT EXISTS idx_validations_fingerprint ON validations(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_validations_domain ON validations(domain);
CREATE INDEX IF NOT EXISTS idx_validations_block_reason ON validations(block_reason) WHERE decision = 'block';
CREATE INDEX IF NOT EXISTS idx_validations_experiment ON validations(experiment_id, variant) WHERE experiment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS training_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    event TEXT NOT NULL CHECK(event IN (
        'training_started', 'training_completed', 'training_failed',
        'validation_passed', 'validation_failed', 'lock_acquired',
        'lock_failed', 'anomaly_detected', 'candidate_created'
    )),
    model_version TEXT,
    trigger_type TEXT CHECK(trigger_type IN ('scheduled', 'manual', 'online', NULL)),
    fraud_count INTEGER,
    legit_count INTEGER,
    total_samples INTEGER,
    training_duration REAL,
    accuracy REAL,
    precision_metric REAL,
    recall REAL,
    f1_score REAL,
    false_positive_rate REAL,
    anomaly_score REAL,
    anomaly_type TEXT,
    error_message TEXT,
    error_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_timestamp ON training_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_training_event ON training_metrics(event);
CREATE INDEX IF NOT EXISTS idx_training_model_version ON training_metrics(model_version);

CREATE TABLE IF NOT EXISTS ab_test_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    event TEXT NOT NULL CHECK(event IN (
        'experiment_created', 'experiment_stopped',
        'variant_assigned', 'promotion_evaluated',
        'model_promoted', 'canary_rollback'
    )),
    experiment_id TEXT,
    variant TEXT CHECK(variant IN ('control', 'treatment', 'none', NULL)),
    bucket INTEGER,
    control_percent REAL,
    treatment_percent REAL,
    control_samples INTEGER,
    treatment_samples INTEGER,
    p_value REAL,
    improvement REAL,
    reason TEXT,
    promotion_decision TEXT CHECK(promotion_decision IN ('promote', 'rollback', 'extend', 'none', NULL))
);

CREATE INDEX IF NOT EXISTS idx_ab_test_timestamp ON ab_test_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_ab_test_experiment ON ab_test_metrics(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_event ON ab_test_metrics(event);

CREATE TABLE IF NOT EXISTS admin_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    event TEXT NOT NULL CHECK(event IN (
        'config_updated', 'weights_changed',
        'feature_toggled', 'manual_training_triggered',
        'model_deployed', 'whitelist_updated'
    )),
    admin_hash TEXT,
    config_key TEXT,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    validation_passed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_timestamp ON admin_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_admin_event ON admin_metrics(event);
CREATE INDEX IF NOT EXISTS idx_admin_config_key ON admin_metrics(config_key);
