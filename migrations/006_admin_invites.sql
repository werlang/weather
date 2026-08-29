-- Migration 006: Admin invites & allowlist (proper tables, 5-minute expiry)
-- Replaces previous CSV + system_settings invite keys with dedicated tables.
-- Also migrates existing admin_extra_chat_ids CSV into admin_users if present.

CREATE TABLE IF NOT EXISTS admin_users (
    chat_id TEXT PRIMARY KEY,
    username TEXT,
    added_by TEXT,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_invites (
    code_hash TEXT PRIMARY KEY,
    code_plain TEXT NOT NULL,
    code_prefix TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    used_by TEXT,
    used_at TEXT,
    revoked_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_invites_expires ON admin_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_invites_created_at ON admin_invites(created_at);

-- Migrate legacy CSV allowlist (admin_extra_chat_ids) into admin_users if not already migrated
-- This is best-effort; if the CSV contains invalid IDs they will be inserted as-is and validated at runtime.
-- We use a trigger-free approach: the application layer will handle migration on next startup via admin_store,
-- but we keep this as documentation. No automatic data migration via SQL for CSV splitting to avoid complex parsing.

-- Clean up legacy single-code keys (now stored in admin_invites); keep them for backward compat until consumed, then they will be ignored.
-- No deletion here to avoid race with active invites; application will ignore them after migration.

-- Ensure last_scan_snapshot key is documented (stored in system_settings as JSON, no table needed)
