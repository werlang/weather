import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countSmsSegments } from '../../src/helpers/sms_client.js';
import { renderAlertSms } from '../../src/bot/sms_templates.js';

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

describe('renderAlertSms compact body', () => {
    const sentAt = new Date('2026-09-12T17:35:00-03:00');

    it('rejects an empty event list', () => {
        assert.throws(() => renderAlertSms({ events: [] }), TypeError);
        assert.throws(() => renderAlertSms({}), TypeError);
    });

    it('carries the hazard, plain severity label, and impacted zone', () => {
        const rendered = renderAlertSms({ events: [makeEvent()], sentAt });

        assert.match(rendered.text, /Tempestade severa/);
        assert.match(rendered.text, /GRANDE PERIGO/);
        assert.match(rendered.text, /Charqueadas/);
        assert.equal(rendered.hazardCount, 1);
        assert.equal(rendered.highestTier, 'RED');
        assert.deepEqual(rendered.cities, ['Charqueadas']);
    });

    it('never emits emoji or markdown that would bloat a segment', () => {
        const rendered = renderAlertSms({ events: [makeEvent()], sentAt });
        // Emoji force UCS-2 encoding on real carriers (70 chars/segment) and
        // are useless in a 160-character municipal alert.
        assert.doesNotMatch(rendered.text, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        assert.doesNotMatch(rendered.text, /[\r\n]/);
    });

    it('stays within one paid segment for a crowded multi-city batch', () => {
        const events = [
            makeEvent({ affectedCities: ['Charqueadas', 'Eldorado do Sul', 'São Leopoldo', 'Campo Bom', 'Novo Hamburgo'] }),
            makeEvent({ type: 'Chuva forte com risco de alagamento', colorTier: 'ORANGE', severity: 'Perigo' }),
            makeEvent({ type: 'Rajadas de vento', colorTier: 'YELLOW', severity: 'Perigo Potencial' })
        ];

        const rendered = renderAlertSms({ events, sentAt });

        assert.ok(rendered.text.length <= 160, `expected <= 160 chars, got ${rendered.text.length}`);
        assert.equal(rendered.segments, 1);
        assert.equal(countSmsSegments(rendered.text), 1);
        assert.ok(rendered.hazardCount >= 1);
        assert.ok(rendered.cities.length >= 1);
    });

    it('drops optional clauses before ever exceeding the limit', () => {
        const manyCities = Array.from({ length: 40 }, (_, index) => `Município ${index} do Vale`);
        const rendered = renderAlertSms({
            events: [makeEvent({ affectedCities: manyCities, type: 'Chuva forte' })],
            sentAt
        });

        assert.ok(rendered.text.length <= 160, `expected <= 160 chars, got ${rendered.text.length}`);
        assert.equal(rendered.segments, 1);
        // The hazard itself must survive every truncation path.
        assert.match(rendered.text, /Chuva forte/);
    });

    it('reports the highest tier across aggregated events', () => {
        const rendered = renderAlertSms({
            events: [
                makeEvent({ colorTier: 'YELLOW', severity: 'Perigo Potencial' }),
                makeEvent({ colorTier: 'ORANGE', severity: 'Perigo' })
            ],
            sentAt
        });
        assert.equal(rendered.highestTier, 'ORANGE');
        assert.match(rendered.text, /PERIGO/);
    });

    it('falls back to the municipality when no city is reported', () => {
        const rendered = renderAlertSms({ events: [makeEvent({ affectedCities: [] })], sentAt });
        assert.match(rendered.text, /Charqueadas/);
        assert.deepEqual(rendered.cities, []);
    });

    it('aggregates repeated occurrences of the same hazard', () => {
        const rendered = renderAlertSms({ events: [makeEvent(), makeEvent()], sentAt });
        assert.equal(rendered.hazardCount, 1);
        assert.ok(rendered.occurrences >= 2);
    });
});
