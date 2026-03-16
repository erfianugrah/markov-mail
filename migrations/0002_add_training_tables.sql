-- Migration: Add training_samples and training_metrics tables
-- for automated container retraining pipeline

-- Training samples: auto-collected from every validation
CREATE TABLE IF NOT EXISTS training_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    email_hash TEXT NOT NULL,
    feature_vector TEXT NOT NULL,
    label INTEGER NOT NULL CHECK(label IN (0, 1)),
    label_source TEXT NOT NULL DEFAULT 'model'
        CHECK(label_source IN ('model', 'manual', 'known_disposable', 'known_provider')),
    risk_score REAL,
    decision TEXT CHECK(decision IN ('allow', 'warn', 'block')),
    model_version TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_training_samples_hash ON training_samples(email_hash);
CREATE INDEX IF NOT EXISTS idx_training_samples_timestamp ON training_samples(timestamp);
CREATE INDEX IF NOT EXISTS idx_training_samples_label ON training_samples(label);

-- Training metrics: audit trail for retraining runs
CREATE TABLE IF NOT EXISTS training_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    event TEXT NOT NULL CHECK(event IN (
        'training_started', 'training_completed', 'training_failed',
        'validation_passed', 'validation_failed', 'lock_acquired',
        'lock_failed', 'anomaly_detected', 'candidate_created',
        'data_pruned'
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
