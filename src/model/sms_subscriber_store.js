/**
 * SMS Subscriber Store.
 * Persists the administrator-managed list of citizens entitled to receive
 * meteorological SMS alerts in the `sms_subscribers` table.
 *
 * Numbers are normalized to Brazilian E.164 before storage, which makes the
 * already-normalized `phone` column the idempotency key: adding `(43) 99999-8888`
 * after `5543999998888` is detected as a duplicate rather than a second entry.
 *
 * @module smsSubscriberStore
 */

import { Sqlite } from '../helpers/database_driver.js';
import { getDatabase } from './log_database.js';
import { normalizeSmsNumber } from '../helpers/sms_client.js';

/** Columns exposed by {@link listSmsSubscribers}. */
const SUBSCRIBER_VIEW = ['phone', 'label', 'added_by', 'created_at'];

/**
 * Lists every stored subscriber ordered by registration time.
 * Errors degrade to an empty list so a broken store never interrupts the bot.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {Array<{ phone: string, label: string|null, addedBy: string|null, createdAt: string|null }>} Subscribers.
 */
export function listSmsSubscribers(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const rows = db.find('sms_subscribers', {
            view: SUBSCRIBER_VIEW,
            opt: { order: { created_at: 1 } }
        });
        return rows.map(row => ({
            phone: String(row.phone),
            label: row.label ?? null,
            addedBy: row.added_by ?? null,
            createdAt: row.created_at ?? null
        }));
    } catch (err) {
        console.error('[sms_subscriber_store] listSmsSubscribers error:', err.message);
        return [];
    }
}

/**
 * Counts stored subscribers.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {number} Subscriber count, 0 when unusable.
 */
export function countSmsSubscribers(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        return db.count('sms_subscribers');
    } catch (err) {
        console.error('[sms_subscriber_store] countSmsSubscribers error:', err.message);
        return 0;
    }
}

/**
 * Adds a subscriber after normalizing the number.
 * Idempotent — an existing number reports `already_present` instead of failing.
 *
 * @param {unknown} rawPhone - Number in any accepted Brazilian format.
 * @param {object} [options] - Registration metadata.
 * @param {string|null} [options.label=null] - Optional human label for the recipient.
 * @param {string|null} [options.addedBy=null] - Chat ID of the admin who added it.
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {{ ok: boolean, phone?: string, reason?: 'invalid_phone'|'already_present'|'error' }} Outcome.
 */
export function addSmsSubscriber(rawPhone, { label = null, addedBy = null } = {}, customDriver = null) {
    let phone;
    try {
        phone = normalizeSmsNumber(rawPhone);
    } catch {
        return { ok: false, reason: 'invalid_phone' };
    }

    try {
        const db = customDriver || getDatabase();
        const existing = db.findOne('sms_subscribers', { filter: { phone }, view: ['phone'] });
        if (existing) return { ok: false, reason: 'already_present' };

        db.insert('sms_subscribers', {
            phone,
            label: label ? String(label) : null,
            added_by: addedBy !== null && addedBy !== undefined ? String(addedBy) : null,
            created_at: new Date().toISOString()
        });
        return { ok: true, phone };
    } catch (err) {
        console.error('[sms_subscriber_store] addSmsSubscriber error:', err.message);
        return { ok: false, reason: 'error' };
    }
}

/**
 * Removes a subscriber by any accepted spelling of its number.
 *
 * @param {unknown} rawPhone - Number to remove.
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {boolean} True when a row was removed.
 */
export function removeSmsSubscriber(rawPhone, customDriver = null) {
    let phone;
    try {
        phone = normalizeSmsNumber(rawPhone);
    } catch {
        return false;
    }

    try {
        const db = customDriver || getDatabase();
        const existing = db.findOne('sms_subscribers', { filter: { phone }, view: ['phone'] });
        if (!existing) return false;
        db.delete('sms_subscribers', { phone });
        return true;
    } catch (err) {
        console.error('[sms_subscriber_store] removeSmsSubscriber error:', err.message);
        return false;
    }
}

/**
 * Returns the normalized numbers to dispatch to, sorted for stable receipts.
 *
 * @param {typeof Sqlite|null} [customDriver=null] - Optional driver for tests.
 * @returns {string[]} E.164 numbers, empty when unusable.
 */
export function getSmsNumbers(customDriver = null) {
    return listSmsSubscribers(customDriver).map(entry => entry.phone).sort();
}
