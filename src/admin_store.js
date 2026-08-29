/**
 * Admin Invite & Allowlist Store.
 * Manages dynamic administrator chat IDs and single-use 8-char invite codes
 * persisted in SQLite `system_settings` (source of truth, survives restarts).
 *
 * Invite codes are A-Z0-9, 8 chars, single-use. Non-admin Telegram users must
 * paste a valid code as plain text to be promoted to administrator.
 *
 * @module adminStore
 */

import { randomInt } from 'node:crypto';
import { Sqlite } from './database_driver.js';
import { getDatabase, saveSystemSetting, getSystemSetting } from './log_database.js';
import { parseTelegramAdminChatIds } from './telegram.js';

/** Length of generated invite codes. */
export const INVITE_CODE_LENGTH = 8;

/** Allowed characters for invite codes (A-Z0-9). */
export const INVITE_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Validation regex for invite codes (exactly 8 alphanum uppercase). */
export const INVITE_CODE_REGEX = /^[A-Z0-9]{8}$/;

/** System settings keys. */
export const ADMIN_EXTRA_KEY = 'admin_extra_chat_ids';
export const INVITE_CODE_KEY = 'admin_invite_code';
export const INVITE_CREATED_AT_KEY = 'admin_invite_created_at';
export const INVITE_CREATED_BY_KEY = 'admin_invite_created_by';

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
 * Retrieves persisted extra administrator chat IDs from the database.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {string[]} Deduplicated chat IDs.
 */
export function getPersistedAdminChatIds(customDriver = null) {
    try {
        const raw = getSystemSetting(ADMIN_EXTRA_KEY, '', customDriver);
        if (!raw || String(raw).trim() === '') return [];
        return parseTelegramAdminChatIds(raw);
    } catch {
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
 * Persists a new administrator chat ID.
 * Idempotent — duplicate adds are ignored.
 *
 * @param {number|string} chatId - Chat ID to add.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean} True if added or already present.
 */
export function addPersistedAdminChatId(chatId, customDriver = null) {
    const id = String(chatId).trim();
    if (!id || !/^-?\d+$/.test(id)) return false;
    try {
        const existing = getPersistedAdminChatIds(customDriver);
        if (existing.includes(id)) return true;
        const updated = [...existing, id];
        const value = updated.join(',');
        if (customDriver) {
            return saveSystemSetting(ADMIN_EXTRA_KEY, value, customDriver);
        }
        // Use transaction for atomic read-modify-write when possible
        try {
            const db = getDatabase();
            Sqlite.withTransaction(({ connection }) => {
                // Re-read inside transaction to avoid race
                const row = db.findOne('system_settings', { filter: { key: ADMIN_EXTRA_KEY }, view: ['value'] }, { connection });
                const currentRaw = row ? row.value : '';
                const currentIds = currentRaw ? parseTelegramAdminChatIds(currentRaw) : [];
                if (currentIds.includes(id)) return;
                const next = [...new Set([...currentIds, id])].join(',');
                db.upsert('system_settings', { key: ADMIN_EXTRA_KEY, value: next, updated_at: new Date().toISOString() }, { conflictFields: ['key'] }, { connection });
            });
            return true;
        } catch {
            return saveSystemSetting(ADMIN_EXTRA_KEY, value, customDriver);
        }
    } catch {
        return false;
    }
}

/**
 * Retrieves the active invite code metadata, if any.
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {{ code: string, createdAt: string|null, createdBy: string|null }|null}
 */
export function getActiveInviteCode(customDriver = null) {
    try {
        const code = getSystemSetting(INVITE_CODE_KEY, null, customDriver);
        if (!code || String(code).trim() === '') return null;
        const normalized = normalizeInviteCode(code);
        if (!INVITE_CODE_REGEX.test(normalized)) return null;
        const createdAt = getSystemSetting(INVITE_CREATED_AT_KEY, null, customDriver);
        const createdBy = getSystemSetting(INVITE_CREATED_BY_KEY, null, customDriver);
        return { code: normalized, createdAt, createdBy };
    } catch {
        return null;
    }
}

/**
 * Creates (or replaces) the active invite code.
 * Single active code at a time — previous code is invalidated.
 *
 * @param {number|string} createdByChatId - Creator admin chat ID.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {string} Generated code.
 */
export function createAdminInviteCode(createdByChatId, customDriver = null) {
    const code = generateInviteCode(INVITE_CODE_LENGTH, INVITE_CODE_CHARSET);
    const now = new Date().toISOString();
    const creator = String(createdByChatId);
    try {
        const db = customDriver || getDatabase();
        // Atomically set all three keys
        try {
            Sqlite.withTransaction(({ connection }) => {
                db.upsert('system_settings', { key: INVITE_CODE_KEY, value: code, updated_at: now }, { conflictFields: ['key'] }, { connection });
                db.upsert('system_settings', { key: INVITE_CREATED_AT_KEY, value: now, updated_at: now }, { conflictFields: ['key'] }, { connection });
                db.upsert('system_settings', { key: INVITE_CREATED_BY_KEY, value: creator, updated_at: now }, { conflictFields: ['key'] }, { connection });
            });
        } catch {
            saveSystemSetting(INVITE_CODE_KEY, code, customDriver);
            saveSystemSetting(INVITE_CREATED_AT_KEY, now, customDriver);
            saveSystemSetting(INVITE_CREATED_BY_KEY, creator, customDriver);
        }
    } catch {}
    return code;
}

/**
 * Clears the active invite code (revocation).
 *
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {boolean} True if cleared.
 */
export function clearInviteCode(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        try {
            Sqlite.withTransaction(({ connection }) => {
                db.delete('system_settings', { key: INVITE_CODE_KEY }, {}, { connection });
                db.delete('system_settings', { key: INVITE_CREATED_AT_KEY }, {}, { connection });
                db.delete('system_settings', { key: INVITE_CREATED_BY_KEY }, {}, { connection });
            });
            return true;
        } catch {
            db.delete('system_settings', { key: INVITE_CODE_KEY });
            db.delete('system_settings', { key: INVITE_CREATED_AT_KEY });
            db.delete('system_settings', { key: INVITE_CREATED_BY_KEY });
            return true;
        }
    } catch {
        return false;
    }
}

/**
 * Attempts to consume an invite code and promote the sender to admin.
 * Single-use: successful consumption invalidates the code and persists the new admin.
 *
 * @param {string} rawCode - Code pasted by the user (case-insensitive).
 * @param {number|string} newAdminChatId - Chat ID to promote.
 * @param {typeof Sqlite|null} [customDriver=null]
 * @returns {{ success: boolean, reason?: string }} Result.
 */
export function consumeInviteCode(rawCode, newAdminChatId, customDriver = null) {
    const normalized = normalizeInviteCode(rawCode);
    if (!INVITE_CODE_REGEX.test(normalized)) {
        return { success: false, reason: 'invalid_format' };
    }
    const chatId = String(newAdminChatId).trim();
    if (!chatId || !/^-?\d+$/.test(chatId)) {
        return { success: false, reason: 'invalid_chat_id' };
    }
    try {
        const db = customDriver || getDatabase();
        // Already admin?
        const persisted = getPersistedAdminChatIds(customDriver);
        const envIds = (() => {
            try {
                const all = db.find('system_settings', { filter: { key: ADMIN_EXTRA_KEY }, view: ['value'] });
                void all;
            } catch {}
            return [];
        })();
        void envIds;
        if (persisted.includes(chatId)) {
            return { success: false, reason: 'already_admin' };
        }

        let result = { success: false, reason: 'invalid_code' };

        try {
            Sqlite.withTransaction(({ connection }) => {
                const row = db.findOne('system_settings', { filter: { key: INVITE_CODE_KEY }, view: ['value'] }, { connection });
                const active = row ? normalizeInviteCode(row.value) : null;
                if (!active || active !== normalized) {
                    result = { success: false, reason: 'invalid_code' };
                    return;
                }
                // Check if already an extra admin (re-read inside txn)
                const extraRow = db.findOne('system_settings', { filter: { key: ADMIN_EXTRA_KEY }, view: ['value'] }, { connection });
                const extraRaw = extraRow ? extraRow.value : '';
                const extraIds = extraRaw ? parseTelegramAdminChatIds(extraRaw) : [];
                if (extraIds.includes(chatId)) {
                    result = { success: false, reason: 'already_admin' };
                    return;
                }
                const nextIds = [...new Set([...extraIds, chatId])].join(',');
                const now = new Date().toISOString();
                db.upsert('system_settings', { key: ADMIN_EXTRA_KEY, value: nextIds, updated_at: now }, { conflictFields: ['key'] }, { connection });
                // Single-use: delete invite code
                db.delete('system_settings', { key: INVITE_CODE_KEY }, {}, { connection });
                db.delete('system_settings', { key: INVITE_CREATED_AT_KEY }, {}, { connection });
                db.delete('system_settings', { key: INVITE_CREATED_BY_KEY }, {}, { connection });
                result = { success: true };
            });
        } catch (err) {
            // Fallback non-transactional path
            const active = getActiveInviteCode(customDriver);
            if (!active || active.code !== normalized) {
                return { success: false, reason: 'invalid_code' };
            }
            const added = addPersistedAdminChatId(chatId, customDriver);
            if (!added) return { success: false, reason: 'persist_failed' };
            clearInviteCode(customDriver);
            return { success: true };
        }

        return result;
    } catch (err) {
        return { success: false, reason: 'error' };
    }
}
