/**
 * Admin Invite & Allowlist Store.
 * Manages dynamic administrator chat IDs and single-use 8-char invite codes
 * persisted in dedicated SQLite tables `admin_users` and `admin_invites`.
 * Invite codes are A-Z0-9, 8 chars, single-use, 5-minute expiry by default.
 *
 * @module adminStore
 */

import { randomInt, createHash } from 'node:crypto';
import { Sqlite } from './database_driver.js';
import { getDatabase, getSystemSetting } from './log_database.js';
import { parseTelegramAdminChatIds } from './telegram.js';

/** Length of generated invite codes. */
export const INVITE_CODE_LENGTH = 8;

/** Allowed characters for invite codes (A-Z0-9). */
export const INVITE_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Validation regex for invite codes (exactly 8 alphanum uppercase). */
export const INVITE_CODE_REGEX = /^[A-Z0-9]{8}$/;

/** System settings keys (legacy, kept for migration). */
export const ADMIN_EXTRA_KEY = 'admin_extra_chat_ids';
export const INVITE_CODE_KEY = 'admin_invite_code';
export const INVITE_CREATED_AT_KEY = 'admin_invite_created_at';
export const INVITE_CREATED_BY_KEY = 'admin_invite_created_by';

/** Invite expiry in milliseconds (5 minutes). */
export const INVITE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Hashes an invite code for storage lookup.
 *
 * @param {string} code - Normalized code.
 * @returns {string} Hex digest.
 */
export function hashInviteCode(code) {
    return createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}

/**
 * Generates a cryptographically secure invite code.
 *
 * @param {number} [length=8] - Code length.
 * @param {string} [charset=INVITE_CODE_CHARSET] - Character set.
 * @returns {string} Generated code.
 */
export function generateInviteCode(length = INVITE_CODE_LENGTH, charset = INVITE_CODE_CHARSET) {
    const chars = String(charset);
    if (!chars.length) throw new Error('Invite charset must not be empty.');
    const len = Number(length) > 0 ? Math.floor(Number(length)) : INVITE_CODE_LENGTH;
    let code = '';
    for (let i = 0; i < len; i += 1) {
        const idx = randomInt(0, chars.length);
        code += chars[idx];
    }
    return code;
}

/**
 * Normalizes a raw invite code to canonical uppercase trimmed form.
 *
 * @param {string|null|undefined} raw - Raw user input.
 * @returns {string} Normalized code.
 */
export function normalizeInviteCode(raw) {
    return String(raw || '').trim().toUpperCase();
}

/**
 * Returns whether a string matches the invite code format.
 *
 * @param {string} code - Candidate code.
 * @returns {boolean}
 */
export function isValidInviteCodeFormat(code) {
    return INVITE_CODE_REGEX.test(normalizeInviteCode(code));
}

/**
 * Extracts the first 8-char invite code from arbitrary text (e.g. "my code AB12CD34 please").
 * Returns normalized code or null if none found.
 *
 * @param {string} text - Raw message text.
 * @returns {string|null}
 */
export function extractInviteCodeFromText(text) {
    const normalized = String(text || '').toUpperCase();
    const match = normalized.match(/[A-Z0-9]{8}/);
    if (!match) return null;
    const candidate = match[0];
    return INVITE_CODE_REGEX.test(candidate) ? candidate : null;
}

/**
 * Ensures legacy CSV allowlist is migrated into admin_users table once.
 * Called lazily on reads.
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 */
function migrateLegacyCsvIfNeeded(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const existingCount = db.count('admin_users');
        if (existingCount > 0) return;
        const raw = getSystemSetting(ADMIN_EXTRA_KEY, '', customDriver);
        if (!raw || String(raw).trim() === '') return;
        const ids = parseTelegramAdminChatIds(raw);
        if (!ids.length) return;
        try {
            Sqlite.withTransaction(({ connection }) => {
                for (const chatId of ids) {
                    try {
                        db.upsert('admin_users', { chat_id: String(chatId), added_by: 'legacy_migration', added_at: new Date().toISOString() }, { conflictFields: ['chat_id'] }, { connection });
                    } catch {}
                }
            });
        } catch (err) {
            console.error('[admin_store] Failed to migrate legacy CSV allowlist:', err.message);
        }
    } catch (err) {
        console.error('[admin_store] migrateLegacyCsvIfNeeded error:', err.message);
    }
}

/**
 * Retrieves persisted extra administrator chat IDs from the database.
 * Merges admin_users table + legacy CSV fallback.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {string[]} Deduplicated chat IDs.
 */
export function getPersistedAdminChatIds(customDriver = null) {
    try {
        migrateLegacyCsvIfNeeded(customDriver);
        const db = customDriver || getDatabase();
        const rows = db.find('admin_users', { view: ['chat_id'] });
        const ids = rows.map(r => String(r.chat_id)).filter(id => /^-?\d+$/.test(id));
        return [...new Set(ids)];
    } catch (err) {
        console.error('[admin_store] getPersistedAdminChatIds error:', err.message);
        return [];
    }
}

/**
 * Returns the merged allowlist of env + persisted admins.
 *
 * @param {string[]} [envAdminIds=[]] - IDs from TELEGRAM_ADMIN_CHAT_ID.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {string[]} Deduplicated allowlist.
 */
export function getAllAdminChatIds(envAdminIds = [], customDriver = null) {
    const envList = Array.isArray(envAdminIds) ? envAdminIds.map(id => String(id)) : [];
    const persisted = getPersistedAdminChatIds(customDriver);
    return [...new Set([...envList, ...persisted])];
}

/**
 * Checks if a chat is an admin (env or persisted).
 *
 * @param {number|string|null|undefined} chatId - Candidate chat ID.
 * @param {string[]} [envAdminIds=[]]
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean}
 */
export function isAdminChatId(chatId, envAdminIds = [], customDriver = null) {
    if (chatId === undefined || chatId === null) return false;
    const id = String(chatId);
    const all = getAllAdminChatIds(envAdminIds, customDriver);
    return all.includes(id);
}

/**
 * Persists a new administrator chat ID into admin_users.
 * Idempotent — duplicate adds are ignored.
 *
 * @param {number|string} chatId - Chat ID to add.
 * @param {object} [options]
 * @param {string|null} [options.addedBy=null] - Who added.
 * @param {string|null} [options.username=null] - Telegram username if known.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean} True if added or already present.
 */
export function addPersistedAdminChatId(chatId, options = {}, customDriver = null) {
    // Handle overloaded signature: addPersistedAdminChatId(chatId, customDriver)
    let addedBy = null;
    let username = null;
    let driver = customDriver;
    if (options && typeof options === 'object' && !(options instanceof Sqlite) && !Array.isArray(options) && typeof options !== 'string') {
        // Check if second arg is actually customDriver (when called as (id, driver))
        if (options && typeof options.find === 'function') {
            driver = options;
        } else {
            addedBy = options.addedBy ?? null;
            username = options.username ?? null;
            if (customDriver && typeof customDriver.find === 'function') driver = customDriver;
        }
    } else if (typeof options === 'string' || typeof options === 'number') {
        addedBy = String(options);
    }

    const id = String(chatId).trim();
    if (!id || !/^-?\d+$/.test(id)) return false;
    try {
        const db = driver || getDatabase();
        const existing = db.findOne('admin_users', { filter: { chat_id: id }, view: ['chat_id'] });
        if (existing) return true;
        try {
            Sqlite.withTransaction(({ connection }) => {
                const already = db.findOne('admin_users', { filter: { chat_id: id }, view: ['chat_id'] }, { connection });
                if (already) return;
                db.upsert('admin_users', { chat_id: id, username, added_by: addedBy, added_at: new Date().toISOString() }, { conflictFields: ['chat_id'] }, { connection });
            });
            return true;
        } catch (err) {
            console.error('[admin_store] addPersistedAdminChatId transaction failed:', err.message);
            try {
                db.upsert('admin_users', { chat_id: id, username, added_by: addedBy, added_at: new Date().toISOString() }, { conflictFields: ['chat_id'] });
                return true;
            } catch (innerErr) {
                console.error('[admin_store] addPersistedAdminChatId fallback failed:', innerErr.message);
                return false;
            }
        }
    } catch (err) {
        console.error('[admin_store] addPersistedAdminChatId error:', err.message);
        return false;
    }
}

/**
 * Removes a persisted admin (for future admin management UI).
 *
 * @param {number|string} chatId
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean}
 */
export function removePersistedAdminChatId(chatId, customDriver = null) {
    const id = String(chatId).trim();
    if (!id) return false;
    try {
        const db = customDriver || getDatabase();
        db.delete('admin_users', { chat_id: id });
        return true;
    } catch (err) {
        console.error('[admin_store] removePersistedAdminChatId error:', err.message);
        return false;
    }
}

/**
 * Retrieves the latest active invite code metadata, if any (non-expired, non-used, non-revoked).
 * For backward compat, returns single latest. Use getActiveInvites() for all.
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {{ code: string, codePrefix: string, createdAt: string|null, createdBy: string|null, expiresAt: string|null }|null}
 */
export function getActiveInviteCode(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const nowIso = new Date().toISOString();
        const rows = db.find('admin_invites', {
            filter: { used_by: null, revoked_at: null, expires_at: { '>': nowIso } },
            view: ['code_plain', 'code_prefix', 'created_at', 'created_by', 'expires_at'],
            opt: { order: { created_at: -1 }, limit: 1 }
        });
        if (rows.length > 0) {
            const r = rows[0];
            const normalized = normalizeInviteCode(r.code_plain);
            if (!INVITE_CODE_REGEX.test(normalized)) return null;
            return { code: normalized, codePrefix: r.code_prefix, createdAt: r.created_at, createdBy: r.created_by, expiresAt: r.expires_at };
        }
        // Fallback to legacy system_settings single code if table empty (for migration period)
        const legacyCode = getSystemSetting(INVITE_CODE_KEY, null, customDriver);
        if (legacyCode && String(legacyCode).trim() !== '') {
            const normalized = normalizeInviteCode(legacyCode);
            if (INVITE_CODE_REGEX.test(normalized)) {
                const createdAt = getSystemSetting(INVITE_CREATED_AT_KEY, null, customDriver);
                const createdBy = getSystemSetting(INVITE_CREATED_BY_KEY, null, customDriver);
                // Legacy has no expiry; treat as 5-min from createdAt if available, else assume expired after 5 min
                if (createdAt) {
                    const age = Date.now() - new Date(createdAt).getTime();
                    if (age > INVITE_EXPIRY_MS) return null;
                }
                return { code: normalized, codePrefix: normalized.slice(0, 3) + '...', createdAt, createdBy, expiresAt: null };
            }
        }
        return null;
    } catch (err) {
        console.error('[admin_store] getActiveInviteCode error:', err.message);
        return null;
    }
}

/**
 * Retrieves all active invite codes (non-expired, non-used, non-revoked).
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {Array<{ code: string, codePrefix: string, createdAt: string, createdBy: string, expiresAt: string }>}
 */
export function getActiveInvites(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const nowIso = new Date().toISOString();
        const rows = db.find('admin_invites', {
            filter: { used_by: null, revoked_at: null, expires_at: { '>': nowIso } },
            view: ['code_plain', 'code_prefix', 'created_at', 'created_by', 'expires_at'],
            opt: { order: { created_at: -1 } }
        });
        return rows.map(r => ({
            code: normalizeInviteCode(r.code_plain),
            codePrefix: r.code_prefix,
            createdAt: r.created_at,
            createdBy: r.created_by,
            expiresAt: r.expires_at
        })).filter(r => INVITE_CODE_REGEX.test(r.code));
    } catch (err) {
        console.error('[admin_store] getActiveInvites error:', err.message);
        return [];
    }
}

/**
 * Creates (or replaces) the active invite code with 5-minute expiry.
 * Revokes previous active invites to keep single active for UX simplicity (can be relaxed later).
 *
 * @param {number|string} createdByChatId - Creator admin chat ID.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {string} Generated code.
 */
export function createAdminInviteCode(createdByChatId, customDriver = null) {
    const code = generateInviteCode(INVITE_CODE_LENGTH, INVITE_CODE_CHARSET);
    const codeHash = hashInviteCode(code);
    const codePrefix = code.slice(0, 3) + '•••••';
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_MS).toISOString();
    const creator = String(createdByChatId);
    try {
        const db = customDriver || getDatabase();
        try {
            Sqlite.withTransaction(({ connection }) => {
                // Revoke previous active invites (single active invariant)
                const activeRows = db.find('admin_invites', {
                    filter: { used_by: null, revoked_at: null, expires_at: { '>': nowIso } },
                    view: ['code_hash']
                }, { connection });
                for (const row of activeRows) {
                    db.update('admin_invites', { revoked_at: nowIso }, { code_hash: row.code_hash }, { connection });
                }
                db.insert('admin_invites', {
                    code_hash: codeHash,
                    code_plain: code,
                    code_prefix: codePrefix,
                    created_by: creator,
                    created_at: nowIso,
                    expires_at: expiresAt,
                    attempts: 0
                }, { connection });
            });
        } catch (err) {
            console.error('[admin_store] createAdminInviteCode transaction failed:', err.message);
            // Fallback non-transactional
            try {
                db.insert('admin_invites', {
                    code_hash: codeHash,
                    code_plain: code,
                    code_prefix: codePrefix,
                    created_by: creator,
                    created_at: nowIso,
                    expires_at: expiresAt,
                    attempts: 0
                });
            } catch (innerErr) {
                console.error('[admin_store] createAdminInviteCode fallback failed:', innerErr.message);
                // Still return code but log error; caller will show code but redemption will fail — log already done
            }
        }
    } catch (err) {
        console.error('[admin_store] createAdminInviteCode outer error:', err.message);
    }
    return code;
}

/**
 * Clears all active invite codes (revocation). Single-use codes are revoked, not deleted, for audit.
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean} True if cleared.
 */
export function clearInviteCode(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const nowIso = new Date().toISOString();
        try {
            Sqlite.withTransaction(({ connection }) => {
                const activeRows = db.find('admin_invites', {
                    filter: { used_by: null, revoked_at: null },
                    view: ['code_hash']
                }, { connection });
                for (const row of activeRows) {
                    db.update('admin_invites', { revoked_at: nowIso }, { code_hash: row.code_hash }, { connection });
                }
                // Also clear legacy keys for migration
                try {
                    db.delete('system_settings', { key: INVITE_CODE_KEY }, {}, { connection });
                    db.delete('system_settings', { key: INVITE_CREATED_AT_KEY }, {}, { connection });
                    db.delete('system_settings', { key: INVITE_CREATED_BY_KEY }, {}, { connection });
                } catch {}
            });
            return true;
        } catch (err) {
            console.error('[admin_store] clearInviteCode transaction failed:', err.message);
            try {
                const activeRows = db.find('admin_invites', { view: ['code_hash'] });
                for (const row of activeRows) {
                    try { db.update('admin_invites', { revoked_at: nowIso }, { code_hash: row.code_hash }); } catch {}
                }
                try { db.delete('system_settings', { key: INVITE_CODE_KEY }); } catch {}
                try { db.delete('system_settings', { key: INVITE_CREATED_AT_KEY }); } catch {}
                try { db.delete('system_settings', { key: INVITE_CREATED_BY_KEY }); } catch {}
            } catch {}
            return true;
        }
    } catch (err) {
        console.error('[admin_store] clearInviteCode error:', err.message);
        return false;
    }
}

/**
 * Attempts to consume an invite code and promote the sender to admin.
 * Single-use, 5-minute expiry, increments attempts on failure for rate limiting.
 *
 * @param {string} rawCode - Code pasted by the user (case-insensitive, may contain surrounding text).
 * @param {number|string} newAdminChatId - Chat ID to promote.
 * @param {object} [options]
 * @param {string|null} [options.username=null] - Telegram username if known.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {{ success: boolean, reason?: string }} Result. Reasons: invalid_format, invalid_chat_id, already_admin, invalid_code, expired, revoked, error
 */
export function consumeInviteCode(rawCode, newAdminChatId, options = {}, customDriver = null) {
    let username = null;
    let driver = customDriver;
    if (options && typeof options === 'object' && options.find) {
        driver = options;
        username = null;
    } else if (options && typeof options === 'object') {
        username = options.username ?? null;
        if (customDriver && customDriver.find) driver = customDriver;
    }

    // Allow surrounding text extraction
    const extracted = extractInviteCodeFromText(rawCode) || normalizeInviteCode(rawCode);
    const normalized = normalizeInviteCode(extracted);
    if (!INVITE_CODE_REGEX.test(normalized)) {
        return { success: false, reason: 'invalid_format' };
    }
    const chatId = String(newAdminChatId).trim();
    if (!chatId || !/^-?\d+$/.test(chatId)) {
        return { success: false, reason: 'invalid_chat_id' };
    }
    try {
        const db = driver || getDatabase();
        const persisted = getPersistedAdminChatIds(driver);
        if (persisted.includes(chatId)) {
            return { success: false, reason: 'already_admin' };
        }
        // Also check env admins via isAdminChatId? Check if chat is already env admin by checking if they'd be considered admin via any means
        // We don't have env list here, but we can check admin_users table already includes persisted only; env check is separate.
        // For consume, we only block if already in admin_users; env admins shouldn't be consuming anyway, but if they do, they'll waste code.
        // We allow and treat as already_admin to preserve code.
        const codeHash = hashInviteCode(normalized);
        let result = { success: false, reason: 'invalid_code' };

        try {
            Sqlite.withTransaction(({ connection }) => {
                const row = db.findOne('admin_invites', { filter: { code_hash: codeHash }, view: ['code_hash', 'code_plain', 'expires_at', 'used_by', 'revoked_at', 'attempts'] }, { connection });
                // Fallback to legacy single code if not found in new table
                if (!row) {
                    const legacyCode = getSystemSetting(INVITE_CODE_KEY, null, { find: () => null });
                    // Legacy check not in txn, handle after
                    result = { success: false, reason: 'invalid_code' };
                    return;
                }
                const now = new Date();
                const nowIso = now.toISOString();
                const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
                if (row.revoked_at) {
                    result = { success: false, reason: 'revoked' };
                    return;
                }
                if (row.used_by) {
                    result = { success: false, reason: 'invalid_code' };
                    return;
                }
                if (expiresAt && now > expiresAt) {
                    result = { success: false, reason: 'expired' };
                    return;
                }
                // Check if already admin inside txn (re-read)
                const extraRow = db.findOne('admin_users', { filter: { chat_id: chatId }, view: ['chat_id'] }, { connection });
                if (extraRow) {
                    result = { success: false, reason: 'already_admin' };
                    return;
                }
                // Promote
                db.upsert('admin_users', { chat_id: chatId, username, added_by: row.created_by || 'invite', added_at: nowIso }, { conflictFields: ['chat_id'] }, { connection });
                db.update('admin_invites', { used_by: chatId, used_at: nowIso, attempts: (row.attempts || 0) + 1 }, { code_hash: codeHash }, { connection });
                result = { success: true };
            });

            // Legacy fallback if not found in new table but legacy code exists
            if (result.reason === 'invalid_code') {
                const legacyActive = getActiveInviteCode(driver);
                // If legacy code matches normalized and is from system_settings, consume via legacy path
                if (legacyActive && legacyActive.code === normalized) {
                    const persistedLegacy = getPersistedAdminChatIds(driver);
                    if (persistedLegacy.includes(chatId)) {
                        return { success: false, reason: 'already_admin' };
                    }
                    // Check legacy expiry (5 min from createdAt)
                    if (legacyActive.createdAt) {
                        const age = Date.now() - new Date(legacyActive.createdAt).getTime();
                        if (age > INVITE_EXPIRY_MS) {
                            return { success: false, reason: 'expired' };
                        }
                    }
                    const added = addPersistedAdminChatId(chatId, { addedBy: legacyActive.createdBy, username }, driver);
                    if (!added) return { success: false, reason: 'persist_failed' };
                    // Clear legacy code
                    try {
                        const ldb = driver || getDatabase();
                        ldb.delete('system_settings', { key: INVITE_CODE_KEY });
                        ldb.delete('system_settings', { key: INVITE_CREATED_AT_KEY });
                        ldb.delete('system_settings', { key: INVITE_CREATED_BY_KEY });
                    } catch (err) {
                        console.error('[admin_store] legacy clear after consume failed:', err.message);
                    }
                    return { success: true };
                }
            }

            if (!result.success && result.reason === 'invalid_code') {
                // Increment attempts for existing code if found
                try {
                    const existing = db.findOne('admin_invites', { filter: { code_hash: codeHash }, view: ['attempts'] });
                    if (existing) {
                        try {
                            db.update('admin_invites', { attempts: (existing.attempts || 0) + 1 }, { code_hash: codeHash });
                        } catch (err) {
                            console.error('[admin_store] increment attempts failed:', err.message);
                        }
                    }
                } catch {}
            }

            return result;
        } catch (err) {
            console.error('[admin_store] consumeInviteCode transaction error:', err.message);
            return { success: false, reason: 'error' };
        }
    } catch (err) {
        console.error('[admin_store] consumeInviteCode outer error:', err.message);
        return { success: false, reason: 'error' };
    }
}
