/**
 * Compact SMS Alert Body for Weather Comunicados.
 * Renders the same aggregated hazard as the email comunicado, compressed to the
 * 160-character single-segment budget an emergency municipal alert needs.
 *
 * Deliberately plain text: emoji would force UCS-2 encoding on real carriers
 * (70 characters per segment instead of 160) and buy nothing in an SMS.
 * Optional clauses are dropped before the body is ever allowed to exceed the
 * limit, and the hazard name is always written first so it survives truncation.
 *
 * @module smsTemplates
 */

import { aggregateRiskEvents } from '../monitoring/risk_analyzer.js';
import { countSmsSegments, SMS_SEGMENT_LENGTH } from '../helpers/sms_client.js';

/** Plain-text severity labels — no emoji, no Markdown. */
const SEVERITY_LABELS = {
    RED: 'GRANDE PERIGO',
    ORANGE: 'PERIGO',
    YELLOW: 'PERIGO POTENCIAL',
    UNKNOWN: 'NÃO CLASSIFICADO'
};

/** Fallback zone when no municipality is reported. */
const DEFAULT_ZONE = 'Charqueadas/RS';

/** Closing clause, dropped first when the budget is tight. */
const TAIL_CLAUSE = '. Acompanhe os canais oficiais.';

/** Ranked tiers used to pick the headline severity. */
const TIER_RANK = { YELLOW: 1, ORANGE: 2, RED: 3, UNKNOWN: 0 };

/**
 * Collapses a value to a single line and caps it in code points.
 *
 * @param {unknown} value - Raw text.
 * @param {number} maxLength - Maximum length in code points.
 * @returns {string} Single-line text.
 */
function toSingleLine(value, maxLength) {
    const line = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(line).slice(0, maxLength).join('');
}

/**
 * Resolves the highest severity tier across aggregated events.
 *
 * @param {Array<object>} aggregated - Aggregated risk events.
 * @returns {string} Canonical tier (RED/ORANGE/YELLOW/UNKNOWN).
 */
function resolveHighestTier(aggregated) {
    let highest = 'UNKNOWN';
    let highestRank = -1;
    for (const event of aggregated) {
        const tier = String(event.colorTier || 'UNKNOWN').toUpperCase();
        const rank = TIER_RANK[tier] ?? -1;
        if (rank > highestRank) {
            highestRank = rank;
            highest = tier;
        }
    }
    return highest;
}

/**
 * Formats a compact pt-BR timestamp for the alert stamp.
 *
 * @param {Date|string|number} sentAt - Reference timestamp.
 * @returns {string} Localized day/month and time.
 */
function formatStamp(sentAt) {
    const date = sentAt instanceof Date ? sentAt : new Date(sentAt);
    const valid = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return valid.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Joins clauses from most to least important, dropping from the end until the
 * body fits, then hard-truncating as a final safety net.
 *
 * @param {Array<string>} clauses - Clauses in priority order (index 0 is kept longest).
 * @returns {string} Body guaranteed to fit in one segment.
 */
function fitToSegment(clauses) {
    for (let keep = clauses.length; keep >= 1; keep -= 1) {
        const text = clauses.slice(0, keep).join('');
        if (Array.from(text).length <= SMS_SEGMENT_LENGTH) return text;
    }
    // A single clause that is somehow oversized: keep its head, mark the cut.
    const head = Array.from(clauses[0]).slice(0, SMS_SEGMENT_LENGTH - 3).join('');
    return `${head}...`;
}

/**
 * Renders the compact SMS body for the last scan snapshot.
 *
 * @param {object} [options] - Rendering options.
 * @param {Array<object>} options.events - Raw risk events (last scan snapshot).
 * @param {Date|string|number} [options.sentAt=new Date()] - Reference timestamp.
 * @returns {{ text: string, hazardCount: number, cities: string[], highestTier: string, occurrences: number, segments: number }} Rendered body and metadata.
 * @throws {TypeError} When no events are provided.
 */
export function renderAlertSms({ events, sentAt = new Date() } = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        throw new TypeError('At least one alert event is required.');
    }

    const aggregated = aggregateRiskEvents(events);
    const cities = [...new Set(events.flatMap(event => event.affectedCities || []))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const highestTier = resolveHighestTier(aggregated);

    const hazard = toSingleLine(aggregated[0]?.type || 'Alerta meteorológico', 60) || 'Alerta meteorológico';
    const severity = SEVERITY_LABELS[highestTier] || SEVERITY_LABELS.UNKNOWN;
    const zone = cities.length > 0 ? toSingleLine(cities.join(', '), 80) : DEFAULT_ZONE;
    const stamp = formatStamp(sentAt);

    // Priority order: the hazard line is clause 0 and is dropped last, so the
    // reader always learns what the danger is even after heavy truncation.
    const text = fitToSegment([
        `ALERTA METEOROLÓGICO: ${hazard} — ${severity}`,
        ` em ${zone}`,
        ` (${stamp})`,
        `. ${aggregated.length} alerta(s)`,
        TAIL_CLAUSE
    ]);

    return {
        text,
        hazardCount: aggregated.length,
        cities,
        highestTier,
        occurrences: events.length,
        segments: countSmsSegments(text)
    };
}
