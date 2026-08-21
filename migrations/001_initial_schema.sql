-- Migration 001: Initial Schema for Weather Monitoring & Audit Logging
-- Creates fetch_logs, alert_logs, monitor_cycle_logs, system_settings, and performance indexes.

CREATE TABLE IF NOT EXISTS fetch_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    url TEXT NOT NULL,
    endpoint TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    response_size_bytes INTEGER,
    item_count INTEGER,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS alert_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    event_type TEXT NOT NULL,
    severity TEXT,
    source TEXT,
    affected_cities TEXT,
    trigger_reason TEXT,
    timeframe TEXT,
    details TEXT
);

CREATE TABLE IF NOT EXISTS monitor_cycle_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    radius_km INTEGER,
    cities_count INTEGER,
    high_risk_count INTEGER,
    duration_ms INTEGER,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_timestamp ON fetch_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_endpoint ON fetch_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_success ON fetch_logs(success);
CREATE INDEX IF NOT EXISTS idx_alert_logs_timestamp ON alert_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_alert_logs_severity ON alert_logs(severity);
CREATE INDEX IF NOT EXISTS idx_monitor_cycle_logs_timestamp ON monitor_cycle_logs(timestamp);
