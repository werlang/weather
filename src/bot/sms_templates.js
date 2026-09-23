/**
 * SMS Alert Body for Weather Comunicados.
 * Renders the last scan snapshot as the institution's own message. An SMS
 * carries no hazard table, impacted-zone list or timestamp — that structured
 * view belongs to the e-mail comunicado, which is why the caller resolves the
 * very same institution message for both channels.
 *
 * Deliberately plain text: emoji would force UCS-2 encoding on real carriers
 * (70 characters per segment instead of 160) and buy nothing in an SMS. The
 * body is never truncated — the compose preview reports segments and credits
 * before the administrator pays for them.
 *
 * @module smsTemplates
 */

import { countSmsSegments } from '../helpers/sms_client.js';

/**
 * Collapses a value to a single line. A carrier delivers one concatenated
 * stream, so embedded newlines and repeated blanks are pure noise.
 *
 * @param {unknown} value - Raw text.
 * @returns {string} Single-line text.
 */
function toSingleLine(value) {
    return String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Renders the SMS body for the last scan snapshot.
 *
 * The body is verbatim the institution message; the events only prove there is
 * something worth communicating, mirroring `renderAlertEmail`'s contract.
 *
 * @param {object} [options] - Rendering options.
 * @param {Array<object>} options.events - Raw risk events (last scan snapshot).
 * @param {string} options.message - Institution message that becomes the whole body.
 * @returns {{ text: string, segments: number }} Verbatim body and its paid segment count.
 * @throws {TypeError} When no events or no message are provided.
 */
export function renderAlertSms({ events, message } = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        throw new TypeError('At least one alert event is required.');
    }
    const text = toSingleLine(message);
    if (!text) {
        throw new TypeError('An institution message is required.');
    }
    return { text, segments: countSmsSegments(text) };
}
