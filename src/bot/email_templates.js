/**
 * MJML Alert Email Templates for Weather Comunicados.
 * Renders the hazard summary (description, impacted zone, timeframe) together
 * with the institution's quoted custom message. The MJML source is compiled
 * strictly at send time by `src/email_client.js` (see node-aec inspiration).
 *
 * The institution's custom message persists in SQLite `system_settings`
 * (`email_custom_message`): first use falls back to a default, later edits
 * overwrite it via the Telegram bot flow.
 *
 * @module emailTemplates
 */

import { getSystemSetting, saveSystemSetting } from '../model/log_database.js';
import { aggregateRiskEvents, getAlertTypeLabel } from '../monitoring/risk_analyzer.js';

/** SQLite `system_settings` key holding the last custom message. */
export const EMAIL_CUSTOM_MESSAGE_KEY = 'email_custom_message';

/** Maximum stored custom message length in Unicode code points. */
export const EMAIL_CUSTOM_MESSAGE_MAX_LENGTH = 1000;

/**
 * Default institution message used until the admin edits it via the bot.
 *
 * One message serves **both** dispatch channels: it is quoted inside the
 * structured e-mail comunicado, and it is the entire body of an SMS. It is
 * therefore written to stand alone (no hazard summary, zone or timestamp —
 * the e-mail adds those around it), to stay under `SMS_SEGMENT_LENGTH` so the
 * default never costs more than one credit, and to stay plain text: emoji
 * would push a real carrier to UCS-2 and 70 characters per segment.
 *
 * The stored key keeps its historical `email_custom_message` name because
 * renaming it would orphan already-saved messages.
 */
export const DEFAULT_EMAIL_CUSTOM_MESSAGE = 'Atenção, comunidade acadêmica: as aulas estão dispensadas no turno da noite devido ao alerta meteorológico severo em Charqueadas. Siga os canais oficiais.';

/** Placeholder shown when no impacted city is reported. */
const UNKNOWN_ZONE_LABEL = 'Não informados';

/**
 * Escapes a runtime value before it enters email markup.
 *
 * @param {unknown} value - Runtime value.
 * @returns {string} HTML-safe text.
 */
export function escapeEmailHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Returns the institution's custom message: last saved value, or the default
 * on first use.
 *
 * @param {object|null} [customDriver=null] - Optional database driver.
 * @returns {string} Custom message text.
 */
export function getEmailCustomMessage(customDriver = null) {
    try {
        const saved = getSystemSetting(EMAIL_CUSTOM_MESSAGE_KEY, null, customDriver);
        if (saved && String(saved).trim()) return String(saved);
    } catch {}
    return DEFAULT_EMAIL_CUSTOM_MESSAGE;
}

/**
 * Persists the institution's custom message for future comunicados.
 *
 * @param {unknown} message - New message text.
 * @param {object|null} [customDriver=null] - Optional database driver.
 * @returns {boolean} True when saved.
 */
export function saveEmailCustomMessage(message, customDriver = null) {
    const text = String(message ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) return false;
    const truncated = Array.from(text).slice(0, EMAIL_CUSTOM_MESSAGE_MAX_LENGTH).join('');
    try {
        return saveSystemSetting(EMAIL_CUSTOM_MESSAGE_KEY, truncated, customDriver);
    } catch {
        return false;
    }
}

/**
 * Maps a canonical tier to its email badge color and label.
 *
 * @param {string} tier - Canonical tier (RED/ORANGE/YELLOW/UNKNOWN).
 * @returns {{ color: string, label: string }} Badge presentation.
 */
export function getEmailTierBadge(tier) {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === 'RED') return { color: '#C62828', label: '🔴 GRANDE PERIGO' };
    if (normalized === 'ORANGE') return { color: '#EF6C00', label: '🟠 PERIGO' };
    if (normalized === 'YELLOW') return { color: '#F9A825', label: '🟡 PERIGO POTENCIAL' };
    return { color: '#6A1B9A', label: '❓ NÃO CLASSIFICADO' };
}

/**
 * Resolves the highest severity tier across aggregated events.
 *
 * @param {Array<object>} aggregated - Aggregated risk events.
 * @returns {{ color: string, label: string, tier: string }} Highest badge.
 */
function getHighestBadge(aggregated) {
    const rank = { YELLOW: 1, ORANGE: 2, RED: 3, UNKNOWN: 4 };
    let highest = 'YELLOW';
    let highestRank = 0;
    for (const event of aggregated) {
        const tier = String(event.colorTier || '').toUpperCase() === 'UNKNOWN' ? 'UNKNOWN' : String(event.colorTier || '').toUpperCase();
        const eventRank = rank[tier] ?? 0;
        if (eventRank > highestRank) {
            highestRank = eventRank;
            highest = tier;
        }
    }
    return { ...getEmailTierBadge(highest), tier: highest };
}

/**
 * Formats a timestamp for pt-BR readers (São Paulo timezone).
 *
 * @param {Date|string|number} [sentAt=new Date()] - Reference timestamp.
 * @returns {string} Localized date-time string.
 */
function formatSentAt(sentAt = new Date()) {
    const date = sentAt instanceof Date ? sentAt : new Date(sentAt);
    const valid = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return valid.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Collapses a value to a single header-safe line for the email subject.
 *
 * @param {unknown} value - Raw text.
 * @param {number} maxLength - Maximum length in code points.
 * @returns {string} Single-line text.
 */
function toSingleLine(value, maxLength) {
    const line = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(line).slice(0, maxLength).join('');
}

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Interpolates `{{placeholders}}` with pre-escaped values.
 *
 * @param {string} source - Template source.
 * @param {Record<string,string>} values - Pre-escaped replacement values.
 * @returns {string} Rendered source.
 * @throws {TypeError} On unknown keys or unresolved placeholders.
 */
function interpolate(source, values) {
    const rendered = String(source).replace(PLACEHOLDER_PATTERN, (match, key) => {
        if (!Object.hasOwn(values, key)) {
            throw new TypeError(`Unknown email template placeholder: ${key}`);
        }
        return values[key];
    });
    PLACEHOLDER_PATTERN.lastIndex = 0;
    if (PLACEHOLDER_PATTERN.test(rendered)) {
        PLACEHOLDER_PATTERN.lastIndex = 0;
        throw new TypeError('Email template contains unresolved placeholders.');
    }
    PLACEHOLDER_PATTERN.lastIndex = 0;
    return rendered;
}

/** Base MJML skeleton for alert comunicados. Dynamic blocks are MJML built in JS. */
const ALERT_EMAIL_MJML = `<mjml>
  <mj-head>
    <mj-preview>{{preview}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="15px" line-height="1.6" color="#212121" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#ECEFF1" width="600px">
    <mj-section background-color="#0B3D66" padding="24px">
      <mj-column>
        <mj-text color="#FFFFFF" font-size="12px" font-weight="700">{{eyebrow}}</mj-text>
        <mj-text color="#FFFFFF" font-size="24px" font-weight="700" padding-top="8px">{{heading}}</mj-text>
        <mj-text color="#BBDEFB" font-size="13px">{{dateLine}}</mj-text>
      </mj-column>
    </mj-section>
    {{severityBanner}}
    {{customBox}}
    <mj-section background-color="#FFFFFF" padding="20px 24px">
      <mj-column>
        <mj-text font-size="17px" font-weight="700" color="#0B3D66" padding-bottom="4px">Perigos detectados ({{hazardCount}})</mj-text>
        <mj-text color="#616161" font-size="13px" padding-bottom="12px">{{zoneLine}}</mj-text>
        {{hazardRows}}
      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="0 24px 20px">
      <mj-column>
        <mj-divider border-color="#CFD8DC" />
        <mj-text font-size="12px" color="#757575">{{footer}}</mj-text>
        <mj-text font-size="11px" color="#9E9E9E">{{doNotReply}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

/**
 * Renders the alert comunicado MJML, subject, and plain-text alternative.
 * Contract: hazard description, entity summary (Tipo via getAlertTypeLabel),
 * impacted zone, timeframe, and the quoted institution custom message are
 * always present; technical Origem source codes are never shown; no
 * `{{placeholder}}` leaks.
 *
 * @param {object} [options] - Rendering options.
 * @param {Array<object>} options.events - Raw risk events (last scan snapshot).
 * @param {string} [options.customMessage=''] - Institution message quoted in the email ('' omits the box).
 * @param {Date|string|number} [options.sentAt=new Date()] - Reference timestamp.
 * @returns {{ subject: string, mjml: string, text: string, hazardCount: number, cities: Array<string>, highestTier: string }} Rendered email parts.
 * @throws {TypeError} When no events are provided.
 */
export function renderAlertEmail({ events, customMessage = '', sentAt = new Date() } = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        throw new TypeError('At least one alert event is required.');
    }

    const aggregated = aggregateRiskEvents(events);
    const cities = [...new Set(aggregated.flatMap(event => event.affectedCities || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const badge = getHighestBadge(aggregated);
    const dateLine = formatSentAt(sentAt);
    const custom = String(customMessage ?? '').replace(/\r\n/g, '\n').trim();
    const occurrences = events.length;

    const topType = toSingleLine(aggregated[0]?.type || 'Alerta meteorológico', 80) || 'Alerta meteorológico';
    const subject = `🚨 ${topType} — Charqueadas/RS (${aggregated.length} alerta(s))`;

    const zoneText = cities.length > 0 ? cities.join(', ') : UNKNOWN_ZONE_LABEL;

    const hazardMjmlRows = aggregated.map(event => {
        const eventBadge = getEmailTierBadge(String(event.colorTier || '').toUpperCase() === 'UNKNOWN' ? 'UNKNOWN' : event.colorTier);
        const eventCities = (event.affectedCities || []).length > 0 ? event.affectedCities.join(', ') : UNKNOWN_ZONE_LABEL;
        return [
            `<mj-text font-size="15px" font-weight="700" color="#212121" padding-top="12px">${escapeEmailHtml(`${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico'}`)}</mj-text>`,
            `<mj-text font-size="13px" color="#424242">Resumo da entidade: ${escapeEmailHtml(getAlertTypeLabel(event))}</mj-text>`,
            `<mj-text font-size="13px" color="#424242">Severidade: ${escapeEmailHtml(eventBadge.label)}</mj-text>`,
            `<mj-text font-size="13px" color="#424242">Municípios: ${escapeEmailHtml(eventCities)}</mj-text>`,
            `<mj-text font-size="13px" color="#424242">Janela: ${escapeEmailHtml(event.timeframe || 'Não informada')}</mj-text>`,
            `<mj-text font-size="13px" color="#424242">Motivo: ${escapeEmailHtml(event.triggerReason || event.details || 'Não informado')}</mj-text>`,
            '<mj-divider border-color="#EEEEEE" padding="8px 0" />'
        ].join('\n');
    }).join('\n');

    const severityBanner = [
        `<mj-section background-color="${badge.color}" padding="12px 24px">`,
        '  <mj-column>',
        `    <mj-text color="#FFFFFF" font-size="15px" font-weight="700" align="center">${escapeEmailHtml(`${badge.label} — ${aggregated.length} tipo(s) em ${cities.length} município(s)`)}</mj-text>`,
        '  </mj-column>',
        '</mj-section>'
    ].join('\n');

    const customBox = custom
        ? [
            '<mj-section background-color="#FFF8E1" padding="16px 24px">',
            '  <mj-column border="1px solid #FFE082" padding="16px">',
            '    <mj-text font-size="13px" font-weight="700" color="#E65100">Comunicado da instituição</mj-text>',
            `    <mj-text font-size="15px" font-style="italic" color="#212121">&#8220;${escapeEmailHtml(custom)}&#8221;</mj-text>`,
            '  </mj-column>',
            '</mj-section>'
        ].join('\n')
        : '';

    const mjml = interpolate(ALERT_EMAIL_MJML, {
        preview: escapeEmailHtml(`${badge.label}: ${topType} em ${zoneText}`),
        eyebrow: escapeEmailHtml('MONITOR METEOROLÓGICO • CHARQUEADAS / RS'),
        heading: escapeEmailHtml('Comunicado meteorológico'),
        dateLine: escapeEmailHtml(`Emitido em ${dateLine}`),
        severityBanner,
        customBox,
        hazardCount: escapeEmailHtml(String(aggregated.length)),
        zoneLine: escapeEmailHtml(`Zona impactada: ${zoneText}`),
        hazardRows: hazardMjmlRows,
        footer: escapeEmailHtml(`Fontes: avisos oficiais do INMET e telemetria da Defesa Civil RS. ${occurrences} ocorrência(s) verificada(s) na janela de 24 horas.`),
        doNotReply: escapeEmailHtml('Mensagem automática do monitoramento 24/7 — não responda este e-mail.')
    });

    const textBlocks = [
        'MONITOR METEOROLÓGICO — CHARQUEADAS / RS',
        'Comunicado meteorológico',
        `Emitido em ${dateLine}`,
        '',
        `${badge.label} — ${aggregated.length} tipo(s) em ${cities.length} município(s)`,
        ''
    ];
    if (custom) {
        textBlocks.push('COMUNICADO DA INSTITUIÇÃO:', `"${custom}"`, '');
    }
    textBlocks.push(`PERIGOS DETECTADOS (${aggregated.length}):`, `Zona impactada: ${zoneText}`, '');
    aggregated.forEach((event, index) => {
        const eventBadge = getEmailTierBadge(String(event.colorTier || '').toUpperCase() === 'UNKNOWN' ? 'UNKNOWN' : event.colorTier);
        const eventCities = (event.affectedCities || []).length > 0 ? event.affectedCities.join(', ') : UNKNOWN_ZONE_LABEL;
        textBlocks.push(
            `${index + 1}. ${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico'}`,
            `   Resumo da entidade: ${getAlertTypeLabel(event)}`,
            `   Severidade: ${eventBadge.label}`,
            `   Municípios: ${eventCities}`,
            `   Janela: ${event.timeframe || 'Não informada'}`,
            `   Motivo: ${event.triggerReason || event.details || 'Não informado'}`,
            ''
        );
    });
    textBlocks.push(
        `Fontes: avisos oficiais do INMET e telemetria da Defesa Civil RS. ${occurrences} ocorrência(s) verificada(s) na janela de 24 horas.`,
        'Mensagem automática do monitoramento 24/7 — não responda este e-mail.'
    );

    return {
        subject,
        mjml,
        text: textBlocks.join('\n'),
        hazardCount: aggregated.length,
        cities,
        highestTier: badge.tier
    };
}
