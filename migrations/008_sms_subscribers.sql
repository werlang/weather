-- Migration 008: SMS subscriber list for admin-triggered alert dispatch.
-- Phone numbers are stored already normalized to Brazilian E.164 (55 + DDD + digits)
-- by src/model/sms_subscriber_store.js, so `phone` is the natural idempotency key.

CREATE TABLE IF NOT EXISTS sms_subscribers (
    phone TEXT PRIMARY KEY,
    label TEXT,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_subscribers_created_at ON sms_subscribers(created_at);
