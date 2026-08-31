/**
 * Admin Invite & Allowlist Store.
 * Manages dynamic administrator chat IDs and single-use 8-char invite codes
 * persisted in dedicated SQLite tables `admin_users` and `admin_invites`.
 * Invite codes are A-Z0-9, 8 chars, single-use, 5-minute expiry.
 *
 * @module adminStore
 */

import { randomInt, createHash } from 'node:crypto';
import { Sqlite } from './database_driver.js';
import { getDatabase } from './log_database.js';

/** Length of generated invite codes. */
export const INVITE_CODE_LENGTH = 8;

/** Allowed characters for invite codes (A-Z0-9). */
export const INVITE_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Validation regex for invite codes (exactly 8 alphanum uppercase). */
export const INVITE_CODE_REGEX = /^[A-Z0-9]{8}$/;

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
 * Retrieves persisted extra administrator chat IDs from the database.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {string[]} Deduplicated chat IDs.
 */
export function getPersistedAdminChatIds(customDriver = null) {
    try {
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
    let addedBy = null;
    let username = null;
    let driver = customDriver;
    if (options && typeof options === 'object' && !(options instanceof Sqlite) && !Array.isArray(options) && typeof options !== 'string') {
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
 * Revokes previous active invites to keep single active for UX simplicity.
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
            });
            return true;
        } catch (err) {
            console.error('[admin_store] clearInviteCode transaction failed:', err.message);
            try {
                const activeRows = db.find('admin_invites', { view: ['code_hash'] });
                for (const row of activeRows) {
                    try { db.update('admin_invites', { revoked_at: nowIso }, { code_hash: row.code_hash }); } catch {}
                }
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
        const codeHash = hashInviteCode(normalized);
        let result = { success: false, reason: 'invalid_code' };

        try {
            Sqlite.withTransaction(({ connection }) => {
                const row = db.findOne('admin_invites', { filter: { code_hash: codeHash }, view: ['code_hash', 'code_plain', 'expires_at', 'used_by', 'revoked_at', 'attempts'] }, { connection });
                if (!row) {
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
                const extraRow = db.findOne('admin_users', { filter: { chat_id: chatId }, view: ['chat_id'] }, { connection });
                if (extraRow) {
                    result = { success: false, reason: 'already_admin' };
                    return;
                }
                db.upsert('admin_users', { chat_id: chatId, username, added_by: row.created_by || 'invite', added_at: nowIso }, { conflictFields: ['chat_id'] }, { connection });
                db.update('admin_invites', { used_by: chatId, used_at: nowIso, attempts: (row.attempts || 0) + 1 }, { code_hash: codeHash }, { connection });
                result = { success: true };
            });

            if (!result.success && result.reason === 'invalid_code') {
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
