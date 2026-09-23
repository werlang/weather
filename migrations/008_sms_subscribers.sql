-- Migration 008: SMS subscriber list — admin-added numbers and citizen consent capture.
-- Phone numbers are stored already normalized to Brazilian E.164 (55 + DDD + digits)
-- by src/model/sms_subscriber_store.js, so `phone` is the natural idempotency key.
-- `added_by` holds the chat that authorized the row: the citizen's own chat on the
-- /inscrever consent path, the administrator's chat on the manual add path.

CREATE TABLE IF NOT EXISTS sms_subscribers (
    phone TEXT PRIMARY KEY,
    label TEXT,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_subscribers_created_at ON sms_subscribers(created_at);
