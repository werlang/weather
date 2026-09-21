import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mjml2html from 'mjml';
import {
    DEFAULT_EMAIL_CUSTOM_MESSAGE,
    EMAIL_CUSTOM_MESSAGE_KEY,
    escapeEmailHtml,
    getEmailCustomMessage,
    getEmailTierBadge,
    renderAlertEmail,
    saveEmailCustomMessage
} from '../../src/bot/email_templates.js';
import { getDatabase, closeDatabase, getSystemSetting } from '../../src/model/log_database.js';

/**
 * Builds a representative high-risk event batch.
 *
 * @returns {Array<object>} Raw risk events.
 */
function makeEvents() {
    return [
        {
            emoji: '⛈️',
            type: 'Tempestade severa',
            severity: 'Grande Perigo',
            colorTier: 'RED',
            source: 'INMET_OFFICIAL_WARNING',
            affectedCities: ['Charqueadas', 'São Jerônimo'],
            timeframe: '10/09/2026 18:00 -> 11/09/2026 18:00',
            triggerReason: 'INMET (Grande Perigo) ativo na região.',
            details: 'Chuva intensa com rajadas de vento.'
        },
        {
            emoji: '🌊',
            type: 'Elevação do Rio Jacuí',
            severity: 'Alerta',
            colorTier: 'ORANGE',
            source: 'DEFESA_CIVIL',
            affectedCities: ['Charqueadas'],
            timeframe: 'Próximas 24h',
            triggerReason: 'Nível do rio em subida rápida.',
            details: 'Quota de alerta atingida em DCRS-00032.'
        }
    ];
}

describe('Alert email custom message store', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    afterEach(() => {
        closeDatabase(testDb);
    });

    it('returns the default message on first use', () => {
        assert.equal(getEmailCustomMessage(testDb), DEFAULT_EMAIL_CUSTOM_MESSAGE);
        assert.match(DEFAULT_EMAIL_CUSTOM_MESSAGE, /comunidade acadêmica/);
    });

    it('persists an edited message and returns it afterwards', () => {
        const edited = 'Boa tarde comunidade academica. As aulas estão dispensadas no turno da noite de hoje devido à tempestade.';
        assert.equal(saveEmailCustomMessage(edited, testDb), true);
        assert.equal(getEmailCustomMessage(testDb), edited);
        assert.equal(getSystemSetting(EMAIL_CUSTOM_MESSAGE_KEY, null, testDb), edited);
    });

    it('rejects empty messages and keeps the previous value', () => {
        assert.equal(saveEmailCustomMessage('Boa noite, todos em alerta.', testDb), true);
        assert.equal(saveEmailCustomMessage('   ', testDb), false);
        assert.equal(saveEmailCustomMessage('', testDb), false);
        assert.equal(getEmailCustomMessage(testDb), 'Boa noite, todos em alerta.');
    });

    it('escapes HTML special characters', () => {
        assert.equal(escapeEmailHtml('<b>"a"&\'b\'</b>'), '&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;');
    });

    it('maps tiers to email badge colors', () => {
        assert.deepEqual(getEmailTierBadge('RED'), { color: '#C62828', label: '🔴 GRANDE PERIGO' });
        assert.deepEqual(getEmailTierBadge('ORANGE'), { color: '#EF6C00', label: '🟠 PERIGO' });
        assert.deepEqual(getEmailTierBadge('YELLOW'), { color: '#F9A825', label: '🟡 PERIGO POTENCIAL' });
        assert.deepEqual(getEmailTierBadge('UNKNOWN'), { color: '#6A1B9A', label: '❓ NÃO CLASSIFICADO' });
    });
});

describe('Alert email rendering contract', () => {
    it('includes hazard description, impacted zone, and quoted custom message', () => {
        const custom = 'Boa tarde comunidade academica. As aulas estão dispensadas no turno da noite de hoje.';
        const rendered = renderAlertEmail({
            events: makeEvents(),
            customMessage: custom,
            sentAt: new Date('2026-09-10T18:00:00Z')
        });

        assert.match(rendered.subject, /Tempestade severa/);
        assert.match(rendered.subject, /Charqueadas\/RS/);
        assert.equal(rendered.hazardCount, 2);
        assert.deepEqual(rendered.cities, ['Charqueadas', 'São Jerônimo']);
        assert.equal(rendered.highestTier, 'RED');

        for (const part of [rendered.mjml, rendered.text]) {
            assert.match(part, /Tempestade severa/);
            assert.match(part, /Rio Jacuí/);
            assert.match(part, /Charqueadas/);
            assert.match(part, /São Jerônimo/);
            assert.match(part, /Resumo da entidade/);
            assert.match(part, /Ventos/);
            assert.match(part, /Nível dos Rios/);
            assert.match(part, /aulas estão dispensadas/);
            assert.doesNotMatch(part, /Origem/);
            assert.doesNotMatch(part, /INMET_OFFICIAL_WARNING/);
            assert.doesNotMatch(part, /DEFESA_CIVIL/);
        }
        assert.doesNotMatch(rendered.mjml, /\{\{[^}]+\}\}/);
        assert.doesNotMatch(rendered.text, /\{\{[^}]+\}\}/);
    });

    it('omits the institution box when the custom message is skipped', () => {
        const rendered = renderAlertEmail({ events: makeEvents(), customMessage: '' });
        assert.doesNotMatch(rendered.mjml, /Comunicado da institui/);
        assert.doesNotMatch(rendered.text, /COMUNICADO DA INSTITUI/);
        assert.match(rendered.mjml, /Tempestade severa/);
    });

    it('escapes injected markup in event fields and custom message', () => {
        const rendered = renderAlertEmail({
            events: [{
                emoji: '🔴',
                type: '<script>alert(1)</script>',
                severity: 'Grande Perigo',
                colorTier: 'RED',
                source: 'INMET_OFFICIAL_WARNING',
                affectedCities: ['Charqueadas'],
                timeframe: 'Agora',
                triggerReason: 'x'
            }],
            customMessage: '<b>oi</b>'
        });
        assert.doesNotMatch(rendered.mjml, /<script>/);
        assert.match(rendered.mjml, /&lt;script&gt;/);
        assert.match(rendered.mjml, /&lt;b&gt;oi&lt;\/b&gt;/);
    });

    it('requires at least one event', () => {
        assert.throws(() => renderAlertEmail({ events: [] }), TypeError);
        assert.throws(() => renderAlertEmail({}), TypeError);
    });

    it('compiles the rendered MJML strictly with the real compiler', () => {
        const rendered = renderAlertEmail({
            events: makeEvents(),
            customMessage: DEFAULT_EMAIL_CUSTOM_MESSAGE,
            sentAt: new Date('2026-09-10T18:00:00Z')
        });
        const { html, errors } = mjml2html(rendered.mjml, { validationLevel: 'strict' });
        assert.deepEqual(errors, []);
        assert.match(html, /Tempestade severa/);
        assert.match(html, /Charqueadas/);
        assert.match(html, /aulas estão dispensadas/);
    });

    it('compiles the skipped-message variant strictly', () => {
        const rendered = renderAlertEmail({ events: makeEvents(), customMessage: '' });
        const { errors } = mjml2html(rendered.mjml, { validationLevel: 'strict' });
        assert.deepEqual(errors, []);
    });
});
