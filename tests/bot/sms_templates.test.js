import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countSmsSegments, SMS_SEGMENT_LENGTH } from '../../src/helpers/sms_client.js';
import { renderAlertSms } from '../../src/bot/sms_templates.js';
import { DEFAULT_EMAIL_CUSTOM_MESSAGE } from '../../src/bot/email_templates.js';

/** Matches emoji blocks and dingbats that would force UCS-2 on a carrier. */
const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * Builds a minimal risk event in the shape produced by the analyzer.
 *
 * @param {object} [overrides] - Field overrides.
 * @returns {object} Risk event fixture.
 */
function makeEvent(overrides = {}) {
    return {
        emoji: '⛈️',
        type: 'Tempestade severa',
        severity: 'Grande Perigo',
        colorTier: 'RED',
        source: 'INMET_OFFICIAL_WARNING',
        affectedCities: ['Charqueadas'],
        timeframe: 'Agora -> 22:00',
        triggerReason: 'Alerta oficial do INMET',
        details: 'Chuva intensa',
        ...overrides
    };
}

describe('renderAlertSms institution body', () => {
    it('rejects an empty event list', () => {
        assert.throws(() => renderAlertSms({ events: [] }), TypeError);
        assert.throws(() => renderAlertSms({}), TypeError);
    });

    it('rejects a missing or blank institution message', () => {
        assert.throws(() => renderAlertSms({ events: [makeEvent()] }), TypeError);
        assert.throws(() => renderAlertSms({ events: [makeEvent()], message: '   ' }), TypeError);
        assert.throws(() => renderAlertSms({ events: [makeEvent()], message: '\r\n\t ' }), TypeError);
    });

    it('sends the institution message verbatim as the whole body', () => {
        const message = 'Aulas suspensas neste turno por risco meteorológico severo.';
        const rendered = renderAlertSms({ events: [makeEvent()], message });

        assert.equal(rendered.text, message);
        assert.equal(rendered.segments, countSmsSegments(message));
    });

    it('never inherits the hazard, zone or timestamp the e-mail carries', () => {
        const crowdedCities = Array.from({ length: 40 }, (_, index) => `Município ${index} do Vale`);
        const message = 'Mensagem da instituição para a comunidade.';
        const rendered = renderAlertSms({
            events: [makeEvent({ type: 'Chuva forte', affectedCities: crowdedCities })],
            message
        });

        assert.equal(rendered.text, message);
        assert.doesNotMatch(rendered.text, /Chuva forte/);
        assert.doesNotMatch(rendered.text, /Município 3 do Vale/);
        assert.doesNotMatch(rendered.text, /\d{2}\/\d{2}\/\d{4}/);
    });

    it('flattens line breaks and collapses repeated blanks for the carrier', () => {
        const rendered = renderAlertSms({
            events: [makeEvent()],
            message: 'Linha um,\r\nlinha dois   com  espaços.'
        });

        assert.equal(rendered.text, 'Linha um, linha dois com espaços.');
    });

    it('never emits emoji that would bloat a segment', () => {
        const rendered = renderAlertSms({ events: [makeEvent()], message: DEFAULT_EMAIL_CUSTOM_MESSAGE });

        assert.doesNotMatch(rendered.text, EMOJI_PATTERN);
        assert.doesNotMatch(rendered.text, /[\r\n]/);
    });

    it('prices a longer message in more segments without truncating it', () => {
        const message = 'x'.repeat(SMS_SEGMENT_LENGTH + 40);
        const rendered = renderAlertSms({ events: [makeEvent()], message });

        assert.equal(rendered.text, message, 'the institution wording must never be cut');
        assert.equal(rendered.segments, 2);
        assert.equal(countSmsSegments(rendered.text), 2);
    });
});

describe('default institution message shared by e-mail and SMS', () => {
    it('costs exactly one paid segment', () => {
        assert.equal(countSmsSegments(DEFAULT_EMAIL_CUSTOM_MESSAGE), 1);
        assert.ok(Array.from(DEFAULT_EMAIL_CUSTOM_MESSAGE).length <= SMS_SEGMENT_LENGTH);
    });

    it('stands alone without the structured summary around it', () => {
        assert.match(DEFAULT_EMAIL_CUSTOM_MESSAGE, /comunidade acadêmica/);
        assert.match(DEFAULT_EMAIL_CUSTOM_MESSAGE, /aulas estão dispensadas/);
        assert.doesNotMatch(DEFAULT_EMAIL_CUSTOM_MESSAGE, EMOJI_PATTERN);
        assert.doesNotMatch(DEFAULT_EMAIL_CUSTOM_MESSAGE, /[\r\n]/);
    });
});
