import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never touch the developer's real database file.
process.env.DB_PATH = ':memory:';

import { Sqlite } from '../../src/helpers/database_driver.js';
import { getDatabase } from '../../src/model/log_database.js';
import { TelegramBotClient } from '../../src/bot/telegram.js';
import { WeatherTelegramBot } from '../../src/bot/telegram_bot.js';
import {
    buildActiveAlertsKeyboard,
    buildAlertActionKeyboard,
    buildSettingsKeyboard,
    buildSmsComposeKeyboard,
    buildSmsSubscribersKeyboard
} from '../../src/bot/keyboards.js';
import {
    addSmsSubscriber,
    countSmsSubscribers,
    listSmsSubscribers
} from '../../src/model/sms_subscriber_store.js';

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
 * Builds a bot instance with injected SMS seams (no real DB writes or HTTP).
 *
 * @param {object} [overrides] - Seam overrides.
 * @returns {object} Test fixtures.
 */
function createSmsBot({ snapshotEvents = null, smsService = null } = {}) {
    const fakeBot = createFakeBot();
    const client = new TelegramBotClient({
        token: 'test-token',
        adminChatIds: ['123'],
        botFactory: () => fakeBot,
        logger: { error() {} }
    });
    const events = snapshotEvents || [{
        emoji: '⛈️',
        type: 'Tempestade severa',
        severity: 'Grande Perigo',
        colorTier: 'RED',
        source: 'INMET_OFFICIAL_WARNING',
        affectedCities: ['Charqueadas'],
        timeframe: 'Agora -> 22:00',
        triggerReason: 'Alerta oficial do INMET',
        details: 'Chuva intensa'
    }];
    const snapshot = { timestamp: new Date().toISOString(), radiusKm: 50, citiesCount: 20, events, dataQuality: { complete: true } };
    const fakeSmsService = smsService || {
        sent: [],
        async send(payload) {
            this.sent.push(payload);
            return {
                recipients: payload.numbers.length,
                segments: 1,
                credits: payload.numbers.length,
                accepted: payload.numbers.length,
                failed: 0,
                results: payload.numbers.map((number, index) => ({
                    number,
                    id: `id-${index}`,
                    situacao: 'OK',
                    codigo: '1',
                    descricao: 'MENSAGEM NA FILA'
                }))
            };
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
        answerCallbackQuery: async () => {},
        editMessageText: async (text, options) => { captured.edited = text; captured.options = options; },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/**
 * Invokes the registered text router with canned context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} text - Incoming message text.
 * @returns {Promise<object>} Captured replies.
 */
async function fireText(fakeBot, text) {
    const handler = fakeBot.eventHandlers.get('message:text');
    const captured = {};
    await handler({
        chat: { id: 123 },
        message: { text },
        reply: async (replyText, options) => {
            captured.replies = captured.replies || [];
            captured.replies.push({ replyText, options });
        }
    });
    return captured;
}

describe('SMS keyboards', () => {
    it('exposes the SMS action behind the consolidated dispatch entry', () => {
        const alertFlat = buildAlertActionKeyboard().inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(alertFlat.includes('action:dispatches'));

        const activeFlat = buildActiveAlertsKeyboard().inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(activeFlat.includes('action:dispatches'));
    });

    it('exposes subscriber management from the settings menu', () => {
        const flat = buildSettingsKeyboard({}).inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(flat.includes('menu:sms'));
    });

    it('hides send when there are no active alerts or subscribers', () => {
        const canSend = buildSmsComposeKeyboard({ canSend: true, hasSubscribers: true }).inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(canSend.includes('action:sms_send'));

        const noAlerts = buildSmsComposeKeyboard({ canSend: false, hasSubscribers: true }).inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(!noAlerts.includes('action:sms_send'));

        const noSubs = buildSmsComposeKeyboard({ canSend: true, hasSubscribers: false }).inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(!noSubs.includes('action:sms_send'));
        assert.ok(noSubs.includes('menu:sms'));
    });

    it('offers add, list, and back on the subscribers screen', () => {
        const flat = buildSmsSubscribersKeyboard().inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(flat.includes('action:sms_add'));
        assert.ok(flat.includes('action:sms_list'));
        assert.ok(flat.includes('menu:settings'));
    });
});

describe('SMS compose preview', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('summarises the message, recipient count, and credit cost', () => {
        addSmsSubscriber('43999998888');
        addSmsSubscriber('51988887777');
        const { bot } = createSmsBot();

        const compose = bot.renderSmsCompose();

        assert.equal(compose.canSend, true);
        assert.equal(compose.hasSubscribers, true);
        assert.equal(compose.recipientCount, 2);
        assert.match(compose.text, /SMS/);
        assert.match(compose.text, /Tempestade severa/);
        assert.match(compose.text, /2/);
        assert.ok(compose.text.length > 0);
    });

    it('blocks sending when the subscriber list is empty', () => {
        const { bot } = createSmsBot();
        const compose = bot.renderSmsCompose();

        assert.equal(compose.canSend, false);
        assert.equal(compose.hasSubscribers, false);
        assert.equal(compose.recipientCount, 0);
        assert.match(compose.text, /Nenhum inscrito/);
    });

    it('reports no active alerts when the snapshot is empty', () => {
        addSmsSubscriber('43999998888');
        const { bot } = createSmsBot({ snapshotEvents: [] });
        const compose = bot.renderSmsCompose();

        assert.equal(compose.canSend, false);
        assert.match(compose.text, /Nenhum alerta ativo/);
    });
});

describe('SMS send flow via admin buttons', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('dispatches to every subscriber and renders the receipt', async () => {
        addSmsSubscriber('43999998888');
        addSmsSubscriber('51988887777');
        const { bot, smsService } = createSmsBot();

        const result = await bot.sendAlertSms();

        assert.equal(result.ok, true);
        assert.equal(result.recipientCount, 2);
        assert.equal(smsService.sent.length, 1);
        assert.deepEqual(smsService.sent[0].numbers, ['5543999998888', '5551988887777']);
        // The body is the institution message alone — shared with the e-mail.
        // The hazard summary belongs to the compose preview, never to the
        // carrier payload.
        assert.equal(smsService.sent[0].body, bot.renderSmsCompose().body);
        assert.match(smsService.sent[0].body, /comunidade acadêmica/);
        assert.doesNotMatch(smsService.sent[0].body, /Tempestade severa/);

        const text = WeatherTelegramBot.renderSmsResult(result);
        assert.match(text, /SMS ENVIADO/);
        assert.match(text, /2/);
    });

    it('refuses to send with an empty subscriber list', async () => {
        const { bot, smsService } = createSmsBot();
        const result = await bot.sendAlertSms();

        assert.equal(result.ok, false);
        assert.match(result.error, /inscrito/);
        assert.equal(smsService.sent.length, 0);
    });

    it('refuses to send without active alerts', async () => {
        addSmsSubscriber('43999998888');
        const { bot, smsService } = createSmsBot({ snapshotEvents: [] });
        const result = await bot.sendAlertSms();

        assert.equal(result.ok, false);
        assert.match(result.error, /Nenhum alerta ativo/);
        assert.equal(smsService.sent.length, 0);
    });

    it('contains gateway failures as { ok: false } and reports partial delivery', async () => {
        addSmsSubscriber('43999998888');
        addSmsSubscriber('51988887777');
        const { bot } = createSmsBot({
            smsService: {
                async send() {
                    return {
                        recipients: 2,
                        segments: 1,
                        credits: 2,
                        accepted: 1,
                        failed: 1,
                        results: [
                            { number: '5543999998888', id: '1', situacao: 'OK', codigo: '1', descricao: 'MENSAGEM NA FILA' },
                            { number: '5551988887777', id: '2', situacao: 'ERRO', codigo: '10', descricao: 'SALDO INSUFICIENTE' }
                        ]
                    };
                }
            }
        });

        const result = await bot.sendAlertSms();
        assert.equal(result.ok, false);
        assert.equal(result.accepted, 1);
        assert.equal(result.failed, 1);
        assert.match(result.error, /SALDO INSUFICIENTE/);

        const text = WeatherTelegramBot.renderSmsResult(result);
        assert.match(text, /FALHA/);
    });

    it('never throws when the transport explodes', async () => {
        addSmsSubscriber('43999998888');
        const { bot } = createSmsBot({
            smsService: {
                async send() {
                    throw new Error('network down');
                }
            }
        });

        const result = await bot.sendAlertSms();
        assert.equal(result.ok, false);
        assert.match(result.error, /network down/);
    });

    it('answers the compose button with a preview and the send button with a receipt', async () => {
        addSmsSubscriber('43999998888');
        const { bot, fakeBot } = createSmsBot();

        const compose = await fireCallback(fakeBot, 'action:sms_compose');
        assert.match(compose.edited, /SMS/);
        const composeButtons = compose.options.reply_markup.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(composeButtons.includes('action:sms_send'));

        const sent = await fireCallback(fakeBot, 'action:sms_send');
        assert.match(sent.edited, /SMS ENVIADO/);
    });
});

describe('SMS subscriber management flow', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('adds a subscriber from the next admin text message', async () => {
        const { bot, fakeBot } = createSmsBot();

        const prompt = await fireCallback(fakeBot, 'action:sms_add');
        assert.match(prompt.edited, /número/);

        const captured = await fireText(fakeBot, '(43) 99999-8888');
        assert.match(captured.replies[0].replyText, /adicionado/);
        assert.equal(countSmsSubscribers(), 1);

        const list = await fireCallback(fakeBot, 'action:sms_list');
        assert.match(list.edited, /5543999998888/);
        void bot;
    });

    it('rejects a malformed number and keeps the pending state cleared', async () => {
        const { fakeBot } = createSmsBot();

        await fireCallback(fakeBot, 'action:sms_add');
        const captured = await fireText(fakeBot, 'não é número');

        assert.match(captured.replies[0].replyText, /inválido|inválida/);
        assert.equal(countSmsSubscribers(), 0);
    });

    it('removes a subscriber from the list', async () => {
        addSmsSubscriber('43999998888');
        const { fakeBot } = createSmsBot();

        const list = await fireCallback(fakeBot, 'action:sms_list');
        assert.match(list.edited, /5543999998888/);

        await fireCallback(fakeBot, 'action:sms_remove:5543999998888');
        assert.equal(countSmsSubscribers(), 0);
        assert.deepEqual(listSmsSubscribers(), []);
    });

    it('shows an empty-state on the subscribers screen', async () => {
        const { fakeBot } = createSmsBot();
        const captured = await fireCallback(fakeBot, 'menu:sms');
        assert.match(captured.edited, /SMS/);
    });
});
