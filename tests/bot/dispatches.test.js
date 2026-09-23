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
    buildDispatchesKeyboard
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
 * Builds a bot instance with injected seams (no real DB writes or HTTP).
 *
 * @param {object} [overrides] - Seam overrides.
 * @returns {object} Test fixtures.
 */
function createDispatchBot({ snapshotEvents = null, smsService = null } = {}) {
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
    const bot = new WeatherTelegramBot({
        telegram: client,
        logger: { error() {}, warn() {}, log() {} },
        smsService: fakeSmsService,
        getSnapshot: () => snapshot
    });
    return { bot, fakeBot, smsService: fakeSmsService, snapshot };
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

describe('Disparos keyboard', () => {
    it('is the single entry point of both alert trays', () => {
        assert.ok(flatCallbacks(buildAlertActionKeyboard()).includes('action:dispatches'));
        assert.ok(flatCallbacks(buildActiveAlertsKeyboard()).includes('action:dispatches'));

        // The two manual channels moved behind that entry, not away from reach.
        const dispatchFlat = flatCallbacks(buildDispatchesKeyboard({}));
        assert.ok(dispatchFlat.includes('action:email_compose'));
        assert.ok(dispatchFlat.includes('action:sms_compose'));
        assert.ok(dispatchFlat.includes('dispatch:toggle:telegram'));
        assert.ok(dispatchFlat.includes('dispatch:toggle:email'));
        assert.ok(dispatchFlat.includes('dispatch:toggle:sms'));
    });

    it('reads an absent channel as armed, matching the runtime default', () => {
        const armed = flatCallbacks(buildDispatchesKeyboard({}));
        assert.ok(armed.every(Boolean), 'every button must carry callback data');

        const disarmed = flatCallbacks(buildDispatchesKeyboard({ email: false }));
        const emailButton = buildDispatchesKeyboard({ email: false })
            .inline_keyboard.flat().find(btn => btn.callback_data === 'dispatch:toggle:email');
        assert.match(emailButton.text, /⬜/);
        const telegramButton = buildDispatchesKeyboard({ email: false })
            .inline_keyboard.flat().find(btn => btn.callback_data === 'dispatch:toggle:telegram');
        assert.match(telegramButton.text, /✅/);
        assert.ok(disarmed.includes('dispatch:toggle:email'));
    });
});

describe('dispatch channel arming', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('defaults every channel to armed so a fresh database starts live', () => {
        const { bot } = createDispatchBot();
        assert.deepEqual(bot.getDispatches(), { telegram: true, email: true, sms: true });
    });

    it('persists a disarm/re-arm round trip on the touched channel only', () => {
        const { bot } = createDispatchBot();

        assert.equal(bot.setDispatchEnabled('sms', false), true);
        assert.equal(bot.isDispatchEnabled('sms'), false);
        assert.equal(getSystemSetting('dispatch_sms'), '0');
        assert.deepEqual(bot.getDispatches(), { telegram: true, email: true, sms: false });

        assert.equal(bot.setDispatchEnabled('sms', true), true);
        assert.equal(bot.isDispatchEnabled('sms'), true);
        assert.equal(getSystemSetting('dispatch_sms'), '1');
    });
});

describe('Disparos screen and toggles', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('opens from the consolidated entry and lists every channel', async () => {
        const { fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'action:dispatches');

        assert.match(captured.edited, /CANAIS DE DISPARO DE ALERTAS/);
        assert.match(captured.edited, /Alertas automáticos \(Telegram\): ✅ ARMADO/);
        assert.ok(flatCallbacks(captured.options.reply_markup).includes('dispatch:toggle:sms'));
    });

    it('flips a channel, persists it, and re-renders the new state', async () => {
        const { bot, fakeBot } = createDispatchBot();

        await fireCallback(fakeBot, 'dispatch:toggle:email');
        assert.equal(bot.isDispatchEnabled('email'), false);

        const reopened = await fireCallback(fakeBot, 'action:dispatches');
        assert.match(reopened.edited, /E-mail \(comunicado\): ⬜ DESARMADO/);

        await fireCallback(fakeBot, 'dispatch:toggle:email');
        assert.equal(bot.isDispatchEnabled('email'), true);
    });

    it('refuses an unknown channel instead of writing a stray key', async () => {
        const { bot, fakeBot } = createDispatchBot();
        const captured = await fireCallback(fakeBot, 'dispatch:toggle:pigeon');

        assert.equal(captured.edited, undefined);
        assert.match(String(captured.answered?.text || ''), /desconhecido/i);
        assert.equal(getSystemSetting('dispatch_pigeon'), null);
        void bot;
    });
});

describe('channel gates', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec("DELETE FROM system_settings WHERE key LIKE 'dispatch_%'");
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('refuses to open the composers of a disarmed channel', async () => {
        const { bot, fakeBot } = createDispatchBot();
        bot.setDispatchEnabled('email', false);
        bot.setDispatchEnabled('sms', false);

        const email = await fireCallback(fakeBot, 'action:email_compose');
        assert.equal(email.edited, undefined);
        assert.match(String(email.answered?.text || ''), /🔔 Disparos/);

        const sms = await fireCallback(fakeBot, 'action:sms_compose');
        assert.equal(sms.edited, undefined);
        assert.match(String(sms.answered?.text || ''), /🔔 Disparos/);
    });

    it('refuses to send on a disarmed channel', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot } = createDispatchBot();
        bot.setDispatchEnabled('email', false);
        bot.setDispatchEnabled('sms', false);

        const email = await fireCallback(fakeBot, 'action:email_send');
        assert.equal(email.edited, undefined);

        const sms = await fireCallback(fakeBot, 'action:sms_send');
        assert.equal(sms.edited, undefined);
        assert.equal(sms.replied, undefined, 'a disarmed channel must not emit the test notice');
    });

    it('silences the automatic Telegram batch while keeping the event logged', async () => {
        const { bot, fakeBot } = createDispatchBot();
        bot.setDispatchEnabled('telegram', false);

        const delivery = await bot.createAlertCallback()([makeEvent()]);
        assert.equal(delivery.skipped, true);
        assert.equal(delivery.sent.length, 0);
        assert.equal(fakeBot.sentMessages.length, 0, 'nothing may reach admins while disarmed');
    });

    it('delivers the automatic Telegram batch when armed', async () => {
        const { bot, fakeBot } = createDispatchBot();

        const delivery = await bot.createAlertCallback()([makeEvent()]);
        assert.equal(delivery.sent.length, 1);
        assert.equal(fakeBot.sentMessages.length, 1);
    });
});

describe('SMS testing mode (admin preview instead of delivery)', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('hands the subscriber-facing body to the triggering admin, bannered as a test', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot } = createDispatchBot();

        const captured = await fireCallback(fakeBot, 'action:sms_send');

        assert.match(captured.replied, /MENSAGEM DE TESTE — NENHUM SMS FOI ENVIADO/);
        assert.match(captured.replied, /Corpo exato que os inscritos receberiam/);
        assert.match(captured.edited, /MODO TESTE — NENHUM SMS ENVIADO/);
        assert.doesNotMatch(captured.edited, /📨 Corpo enviado:/);

        // The notice carries exactly the body subscribers would have received.
        const composed = bot.renderSmsCompose();
        assert.ok(captured.replied.includes(composed.body), 'the notice must show the verbatim body');
    });

    it('flags the notice and reports who would have received it', () => {
        const notice = buildSmsTestingNotice({ body: 'Mensagem da instituição.', recipients: 3 });

        assert.match(notice, /🧪 MENSAGEM DE TESTE/);
        assert.match(notice, /Mensagem da instituição\./);
        assert.match(notice, /👥 Inscritos que receberiam: 3/);
        assert.match(notice, /Nada saiu para a operadora|nada saiu para a operadora/);
    });

    it('renders an empty body without throwing', () => {
        const notice = buildSmsTestingNotice({});
        assert.match(notice, /\(corpo vazio\)/);
    });
});
