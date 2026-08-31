-- Migration 007: Cleanup legacy system_settings keys (dev env, product not launched)
-- Removes single-code invite keys and CSV allowlist now replaced by dedicated tables admin_users/admin_invites.
-- Safe to run repeatedly (DELETE IF EXISTS semantics via WHERE).

DELETE FROM system_settings WHERE key = 'admin_extra_chat_ids';
DELETE FROM system_settings WHERE key = 'admin_invite_code';
DELETE FROM system_settings WHERE key = 'admin_invite_created_at';
DELETE FROM system_settings WHERE key = 'admin_invite_created_by';

-- Legacy interval/radius env remnants are not stored, no cleanup needed.
-- alert_cat_* boolean values already migrated in 005; no further legacy keys.
