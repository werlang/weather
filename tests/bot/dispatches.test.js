import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never touch the developer's real database file.
process.env.DB_PATH = ':memory:';

import { Sqlite } from '../../src/helpers/database_driver.js';
import { getDatabase, getSystemSetting } from '../../src/model/log_database.js';
import { TelegramBotClient } from '../../src/bot/telegram.js';
import { WeatherTelegramBot } from '../../src/bot/telegram_bot.js';
import {
    buildActiveAlertsKeyboard,
    buildAlertActionKeyboard,
    buildAlertDispatchKeyboard,
    buildDispatchConfigKeyboard,
    buildMessageComposeKeyboard,
    buildSettingsKeyboard
} from '../../src/bot/keyboards.js';
import { buildSmsTestingNotice } from '../../src/bot/presentation.js';
import { addSmsSubscriber } from '../../src/model/sms_subscriber_store.js';

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

/**
 * Builds a fake grammY-compatible bot capturing handlers and replies.
 *
 * @returns {object} Fake bot double.
 */
function createFakeBot() {
    const bot = {
        commandHandlers: new Map(),
        eventHandlers: new Map(),
        callbackHandlers: [],
        sentMessages: [],
        command(command, handler) {
            this.commandHandlers.set(command, handler);
        },
        on(filter, handler) {
            this.eventHandlers.set(filter, handler);
        },
        callbackQuery(filter, handler) {
            this.callbackHandlers.push({ filter, handler });
        },
        catch(handler) {
            this.errorHandler = handler;
        }
    };
    bot.api = {
        sendMessage: async (chatId, text, options) => {
            bot.sentMessages.push({ chatId, text, options });
        }
    };
    return bot;
}

/**
 * Builds a bot instance with injected seams (no real DB writes, SMTP or HTTP).
 *
 * @param {object} [overrides] - Seam overrides.
 * @returns {object} Test fixtures.
 */
function createDispatchBot({ snapshotEvents = null, smsService = null, emailService = null } = {}) {
    const fakeBot = createFakeBot();
    const client = new TelegramBotClient({
        token: 'test-token',
        adminChatIds: ['123'],
        botFactory: () => fakeBot,
        logger: { error() {} }
    });
    const events = snapshotEvents || [makeEvent()];
    const snapshot = { timestamp: new Date().toISOString(), radiusKm: 50, citiesCount: 20, events, dataQuality: { complete: true } };
    const fakeSmsService = smsService || {
        sent: [],
        async send(payload) {
            this.sent.push(payload);
            return { testing: true, accepted: payload.numbers.length, failed: 0, segments: 1, credits: 0 };
        }
    };
    const fakeEmailService = emailService || {
        sent: [],
        async send(payload) {
            this.sent.push(payload);
            return { messageId: '<test-id>', previewUrl: 'https://ethereal.email/message/test' };
        }
    };
    const bot = new WeatherTelegramBot({
        telegram: client,
        logger: { error() {}, warn() {}, log() {} },
        smsService: fakeSmsService,
        emailService: fakeEmailService,
        getSnapshot: () => snapshot
    });
    return { bot, fakeBot, smsService: fakeSmsService, emailService: fakeEmailService, snapshot };
}

/**
 * Invokes the registered callback-query router with canned context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} data - Callback data.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured context results.
 */
async function fireCallback(fakeBot, data, { chatId = 123, messageText = '' } = {}) {
    const handler = fakeBot.eventHandlers.get('callback_query:data');
    const captured = {};
    await handler({
        chat: { id: chatId },
        from: { username: 'admin' },
        message: { text: messageText },
        callbackQuery: { data },
        answerCallbackQuery: async answer => { captured.answered = answer; },
        editMessageText: async (text, options) => { captured.edited = text; captured.options = options; },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/** Callback data of every button on a keyboard, flattened. */
const flatCallbacks = keyboard => keyboard.inline_keyboard.flat().map(btn => btn.callback_data);

describe('alert dispatch menu', () => {
    it('is the single Disparos entry of both alert trays', () => {
        assert.ok(flatCallbacks(buildAlertActionKeyboard()).includes('action:dispatches'));
        assert.ok(flatCallbacks(buildActiveAlertsKeyboard()).includes('action:dispatches'));
    });

    it('offers exactly message, configuration, and one dispatch for every means', () => {
        const flat = flatCallbacks(buildAlertDispatchKeyboard());
        assert.deepEqual(flat.sort(), [
            'action:dispatch_send',
            'action:message_compose',
            'action:dispatch_config',
            'action:active_alerts'
        ].sort());
    });

    it('names the channels that will receive the dispatch', async () => {
        const { fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'action:dispatches');

        assert.match(captured.edited, /DISPARO DO ALERTA/);
        assert.match(captured.edited, /📧 E-mail \(comunicado\)/);
        assert.match(captured.edited, /📱 SMS para inscritos/);
        assert.match(captured.edited, /obrigatórios/);
    });
});

describe('dispatch configuration screen', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('lives in the settings menu, not in the alert', () => {
        const settings = flatCallbacks(buildSettingsKeyboard({}));
        assert.ok(settings.includes('action:dispatch_config'));

        // The alert menu only *links* to it — the toggles are not there.
        const alertFlat = flatCallbacks(buildAlertDispatchKeyboard());
        assert.ok(alertFlat.includes('action:dispatch_config'));
        assert.ok(!alertFlat.some(data => data.startsWith('dispatch:toggle:')));
    });

    it('defaults both channels to armed so a fresh database starts live', () => {
        const { bot } = createDispatchBot();
        assert.deepEqual(bot.getDispatches(), { email: true, sms: true });
    });

    it('persists a disarm/re-arm round trip on the touched channel only', () => {
        const { bot } = createDispatchBot();

        assert.equal(bot.setDispatchEnabled('sms', false), true);
        assert.equal(bot.isDispatchEnabled('sms'), false);
        assert.equal(getSystemSetting('dispatch_sms'), '0');
        assert.deepEqual(bot.getDispatches(), { email: true, sms: false });

        assert.equal(bot.setDispatchEnabled('sms', true), true);
        assert.equal(bot.isDispatchEnabled('sms'), true);
        assert.equal(getSystemSetting('dispatch_sms'), '1');
    });

    it('lists both toggles and the composer, and goes back to settings', async () => {
        const { fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'action:dispatch_config');

        assert.match(captured.edited, /CONFIGURAÇÃO DE DISPAROS/);
        assert.match(captured.edited, /E-mail \(comunicado\): ✅ ATIVO/);
        assert.match(captured.edited, /SMS para inscritos: ✅ ATIVO/);

        const flat = flatCallbacks(captured.options.reply_markup);
        assert.ok(flat.includes('dispatch:toggle:email'));
        assert.ok(flat.includes('dispatch:toggle:sms'));
        assert.ok(flat.includes('action:message_compose'));
        assert.ok(flat.includes('menu:settings'));
    });

    it('flips a channel, persists it, and re-renders the new state', async () => {
        const { bot, fakeBot } = createDispatchBot();

        await fireCallback(fakeBot, 'dispatch:toggle:email');
        assert.equal(bot.isDispatchEnabled('email'), false);

        const reopened = await fireCallback(fakeBot, 'action:dispatch_config');
        assert.match(reopened.edited, /E-mail \(comunicado\): ⬜ DESATIVADO/);

        await fireCallback(fakeBot, 'dispatch:toggle:email');
        assert.equal(bot.isDispatchEnabled('email'), true);
    });

    it('refuses an unknown channel instead of writing a stray key', async () => {
        const { fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'dispatch:toggle:pigeon');

        assert.equal(captured.edited, undefined);
        assert.match(String(captured.answered?.text || ''), /desconhecido/i);
        assert.equal(getSystemSetting('dispatch_pigeon'), null);
    });
});

describe('automatic Telegram alerts are not configurable', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('offers no toggle anywhere', () => {
        assert.ok(!flatCallbacks(buildDispatchConfigKeyboard({})).includes('dispatch:toggle:telegram'));
        assert.ok(!flatCallbacks(buildAlertDispatchKeyboard()).includes('dispatch:toggle:telegram'));
    });

    it('rejects the toggle callback and stores nothing', async () => {
        const { fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'dispatch:toggle:telegram');

        assert.equal(captured.edited, undefined);
        assert.match(String(captured.answered?.text || ''), /obrigat/);
        assert.equal(getSystemSetting('dispatch_telegram'), null);
    });

    it('delivers to every administrator with no switch involved', async () => {
        const { bot, fakeBot } = createDispatchBot();

        const delivery = await bot.createAlertCallback()([makeEvent()]);
        assert.equal(delivery.sent.length, 1);
        assert.equal(fakeBot.sentMessages.length, 1);
        assert.equal(getSystemSetting('dispatch_telegram'), null, 'Telegram must need no setting at all');
    });
});

describe('unified message composer', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('is offered by both the alert menu and the configuration screen', () => {
        assert.ok(flatCallbacks(buildAlertDispatchKeyboard()).includes('action:message_compose'));
        assert.ok(flatCallbacks(buildDispatchConfigKeyboard({})).includes('action:message_compose'));
    });

    it('returns to the screen it was opened from', () => {
        assert.equal(
            flatCallbacks(buildMessageComposeKeyboard('action:dispatch_config')).pop(),
            'action:dispatch_config'
        );
        assert.equal(
            flatCallbacks(buildMessageComposeKeyboard('action:dispatches')).pop(),
            'action:dispatches'
        );
    });

    it('renders one message that every means will carry', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot } = createDispatchBot();

        const captured = await fireCallback(fakeBot, 'action:message_compose');
        assert.match(captured.edited, /COMPOSIÇÃO DA MENSAGEM/);
        assert.match(captured.edited, /igual para todos os meios/);
        assert.match(captured.edited, /comunidade acadêmica/);
        assert.match(captured.edited, /Destinatário/);

        const flat = flatCallbacks(captured.options.reply_markup);
        assert.ok(flat.includes('action:message_edit'), 'the composer must offer the edit action');
        assert.ok(flat.includes('action:dispatches'), 'opened from the alert menu, it returns there');

        void bot;
    });

    it('returns to the configuration screen when opened from there', async () => {
        const { bot, fakeBot } = createDispatchBot();
        await fireCallback(fakeBot, 'action:dispatch_config');

        const captured = await fireCallback(fakeBot, 'action:message_compose');
        const flat = flatCallbacks(captured.options.reply_markup);
        assert.ok(flat.includes('action:dispatch_config'));
        void bot;
    });
});

describe('one dispatch over every configured means', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('fires e-mail and SMS together and reports both', async () => {
        addSmsSubscriber('43999998888');
        addSmsSubscriber('51988887777');
        const { bot, fakeBot, emailService, smsService } = createDispatchBot();

        const captured = await fireCallback(fakeBot, 'action:dispatch_send');

        assert.equal(emailService.sent.length, 1, 'the configured e-mail must go out');
        assert.equal(smsService.sent.length, 1, 'the configured SMS must go out');

        assert.match(captured.edited, /DISPARO DE ALERTA/);
        assert.match(captured.edited, /E-MAIL ENVIADO/);
        assert.match(captured.edited, /SMS ENVIADO/);
        void bot;
    });

    it('skips a disarmed channel but still delivers the armed one', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot, emailService, smsService } = createDispatchBot();
        bot.setDispatchEnabled('email', false);

        const captured = await fireCallback(fakeBot, 'action:dispatch_send');

        assert.equal(emailService.sent.length, 0, 'a disarmed channel must stay silent');
        assert.equal(smsService.sent.length, 1);
        assert.match(captured.edited, /DESATIVADO/i);
        assert.match(captured.edited, /SMS ENVIADO/);
    });

    it('refuses to dispatch when no channel is configured', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot, emailService, smsService } = createDispatchBot();
        bot.setDispatchEnabled('email', false);
        bot.setDispatchEnabled('sms', false);

        const captured = await fireCallback(fakeBot, 'action:dispatch_send');

        assert.equal(captured.edited, undefined, 'nothing may be edited without a configured channel');
        assert.match(String(captured.answered?.text || ''), /Nenhum canal configurado/);
        assert.equal(emailService.sent.length, 0);
        assert.equal(smsService.sent.length, 0);
    });

    it('hands the subscriber-facing body to the admin in testing mode', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot } = createDispatchBot();

        const captured = await fireCallback(fakeBot, 'action:dispatch_send');

        assert.match(captured.replied, /MENSAGEM DE TESTE — NENHUM SMS FOI ENVIADO/);
        assert.match(captured.edited, /MODO TESTE — NENHUM SMS ENVIADO/);
        assert.ok(captured.replied.includes(bot.renderMessageCompose().body), 'the notice must show the verbatim body');
    });
});

describe('testing-mode notice copy', () => {
    it('banners the exact body and reports who would have received it', () => {
        const notice = buildSmsTestingNotice({ body: 'Mensagem da instituição.', recipients: 3 });

        assert.match(notice, /🧪 MENSAGEM DE TESTE/);
        assert.match(notice, /Mensagem da instituição\./);
        assert.match(notice, /👥 Inscritos que receberiam: 3/);
        assert.match(notice, /nada saiu para a operadora/);
    });

    it('renders an empty body without throwing', () => {
        assert.match(buildSmsTestingNotice({}), /\(corpo vazio\)/);
    });
});
