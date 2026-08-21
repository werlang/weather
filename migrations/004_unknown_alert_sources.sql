-- Migration 004: Registry for unrecognized alert sources.
-- Stores raw color/severity/summary payloads that did not match the known
-- vocabulary so future analysis can harden the classification rules.

CREATE TABLE IF NOT EXISTS unknown_alert_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    dedupe_key TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    external_id TEXT,
    raw_color TEXT,
    raw_severity TEXT,
    raw_text TEXT,
    city TEXT
);
