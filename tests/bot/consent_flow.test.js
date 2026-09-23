import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never touch the developer's real database file.
process.env.DB_PATH = ':memory:';

import { Sqlite } from '../../src/helpers/database_driver.js';
import { getDatabase } from '../../src/model/log_database.js';
import { TelegramBotClient } from '../../src/bot/telegram.js';
import { WeatherTelegramBot } from '../../src/bot/telegram_bot.js';
import {
    buildConsentKeyboard,
    buildConsentContactKeyboard
} from '../../src/bot/keyboards.js';
import {
    SUBSCRIPTION_KEYWORD,
    CONSENT_CANCEL_LABEL,
    BOT_COMMANDS
} from '../../src/bot/presentation.js';
import { countSmsSubscribers, listSmsSubscribers } from '../../src/model/sms_subscriber_store.js';

/** Chat id of the administrator allowlist in these fixtures. */
const ADMIN_CHAT_ID = 123;

/** Chat id of a regular citizen going through the consent flow. */
const CITIZEN_CHAT_ID = 777;

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
 * Builds a bot instance whose administrator allowlist excludes the citizen.
 *
 * @returns {object} Test fixtures.
 */
function createConsentBot() {
    const fakeBot = createFakeBot();
    const client = new TelegramBotClient({
        token: 'test-token',
        adminChatIds: [String(ADMIN_CHAT_ID)],
        botFactory: () => fakeBot,
        logger: { error() {}, warn() {} }
    });
    const bot = new WeatherTelegramBot({
        telegram: client,
        logger: { error() {}, warn() {}, log() {} }
    });
    return { bot, fakeBot };
}

/**
 * Invokes the registered callback-query router with canned citizen context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} data - Callback data.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured context results.
 */
async function fireCallback(fakeBot, data, { chatId = CITIZEN_CHAT_ID } = {}) {
    const handler = fakeBot.eventHandlers.get('callback_query:data');
    const captured = {};
    await handler({
        chat: { id: chatId },
        from: { id: chatId, username: 'cidadão' },
        message: { text: '' },
        callbackQuery: { data },
        answerCallbackQuery: async () => {},
        editMessageText: async (text, options) => { captured.edited = text; captured.options = options; },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/**
 * Invokes the registered contact-message handler with canned context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured replies.
 */
async function fireContact(fakeBot, { chatId = CITIZEN_CHAT_ID, fromId = chatId, phoneNumber, contactUserId = fromId } = {}) {
    const handler = fakeBot.eventHandlers.get('message:contact');
    const captured = {};
    await handler({
        chat: { id: chatId },
        from: { id: fromId, first_name: 'Maria', username: 'maria' },
        message: {
            contact: {
                phone_number: phoneNumber,
                user_id: contactUserId,
                first_name: 'Maria'
            }
        },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/**
 * Invokes the registered text handler with canned context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} text - Incoming message text.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured replies.
 */
async function fireText(fakeBot, text, { chatId = CITIZEN_CHAT_ID } = {}) {
    const handler = fakeBot.eventHandlers.get('message:text');
    const captured = {};
    await handler({
        chat: { id: chatId },
        from: { id: chatId },
        message: { text },
        reply: async (replyText, options) => {
            captured.replies = captured.replies || [];
            captured.replies.push({ replyText, options });
        }
    });
    return captured;
}

/**
 * Runs /start with a payload the way grammY exposes it (`ctx.match`).
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} payload - Deep-link payload.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured reply.
 */
async function fireStart(fakeBot, payload, { chatId = CITIZEN_CHAT_ID } = {}) {
    const captured = {};
    await fakeBot.commandHandlers.get('start')({
        chat: { id: chatId },
        from: { id: chatId },
        match: payload,
        message: { text: `/start ${payload}` },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/**
 * Runs a registered slash command with canned context.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} command - Command name without the slash.
 * @param {object} [options] - Context overrides.
 * @returns {Promise<object>} Captured reply.
 */
async function fireCommand(fakeBot, command, { chatId = CITIZEN_CHAT_ID } = {}) {
    const captured = {};
    await fakeBot.commandHandlers.get(command)({
        chat: { id: chatId },
        from: { id: chatId },
        match: '',
        message: { text: `/${command}` },
        reply: async (text, options) => { captured.replied = text; captured.replyOptions = options; }
    });
    return captured;
}

/**
 * Walks the full happy path: keyword → agree → shared contact.
 *
 * @param {object} fakeBot - Fake bot double.
 * @param {string} [phoneNumber='+5543999998888'] - Shared contact number.
 * @returns {Promise<object>} The contact-step capture.
 */
async function consentAndShare(fakeBot, phoneNumber = '+5543999998888') {
    await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);
    await fireCallback(fakeBot, 'consent:agree');
    return fireContact(fakeBot, { phoneNumber });
}

describe('Consent keyboards and command menu', () => {
    it('offers the agree and refuse actions on the consent term', () => {
        const flat = buildConsentKeyboard().inline_keyboard.flat().map(btn => btn.callback_data);
        assert.deepEqual(flat, ['consent:agree', 'consent:decline']);
    });

    it('builds a native share-contact button plus a cancel row', () => {
        const keyboard = buildConsentContactKeyboard();
        const rows = keyboard.keyboard;
        assert.equal(rows[0][0].request_contact, true);
        assert.equal(rows[1][0].text, CONSENT_CANCEL_LABEL);
    });

    it('publishes the subscription commands in the autocomplete menu', () => {
        const commands = BOT_COMMANDS.map(entry => entry.command);
        assert.ok(commands.includes(SUBSCRIPTION_KEYWORD));
        assert.ok(commands.includes('sair'));
    });
});

describe('Citizen SMS subscription consent flow', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('opens the official consent term when started with the keyword', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);

        assert.match(captured.replied, /TERMO DE CONSENTIMENTO/);
        assert.match(captured.replied, /IFSUL/);
        assert.match(captured.replied, /13\.709/);
        assert.match(captured.replied, /\/sair/);
        const flat = captured.replyOptions.reply_markup.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.deepEqual(flat, ['consent:agree', 'consent:decline']);
    });

    it('does not misread the keyword as an 8-character invite code', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);

        assert.doesNotMatch(captured.replied, /CONVITE/);
        assert.doesNotMatch(captured.replied, /acesso completo/i);
    });

    it('opens the same consent term on the /inscrever command', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireCommand(fakeBot, 'inscrever');

        assert.match(captured.replied, /TERMO DE CONSENTIMENTO/);
        const flat = captured.replyOptions.reply_markup.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(flat.includes('consent:agree'));
    });

    it('registers the /inscrever command with the Telegram menu', async () => {
        const fakeBot = createFakeBot();
        fakeBot.api.setMyCommands = async () => {};
        const client = new TelegramBotClient({
            token: 'test-token',
            adminChatIds: [],
            botFactory: () => fakeBot,
            logger: { warn() {} }
        });
        let registered = null;
        fakeBot.api.setMyCommands = async commands => { registered = commands; };

        const bot = new WeatherTelegramBot({ telegram: client, logger: { warn() {} } });
        await bot.initCommands();

        assert.ok(registered.some(entry => entry.command === SUBSCRIPTION_KEYWORD));
    });

    it('asks for the native contact only after the user agrees', async () => {
        const { fakeBot } = createConsentBot();
        await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);

        const captured = await fireCallback(fakeBot, 'consent:agree');

        assert.match(captured.edited, /CONSENTIMENTO/);
        const rows = captured.replyOptions.reply_markup.keyboard;
        assert.equal(rows[0][0].request_contact, true);
        assert.equal(rows[1][0].text, CONSENT_CANCEL_LABEL);
    });

    it('stores the shared number and answers with a masked receipt', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await consentAndShare(fakeBot, '(43) 99999-8888');

        assert.equal(countSmsSubscribers(), 1);
        const [entry] = listSmsSubscribers();
        assert.equal(entry.phone, '5543999998888');
        assert.equal(entry.addedBy, String(CITIZEN_CHAT_ID));
        assert.match(captured.replied, /INSCRIÇÃO CONFIRMADA/);
        // The receipt masks the number: full digits never go back on screen.
        assert.doesNotMatch(captured.replied, /999998888/);
        assert.match(captured.replied, /8888/);
        assert.equal(captured.replyOptions.reply_markup.remove_keyboard, true);
    });

    it('rejects a contact card shared by somebody other than the sender', async () => {
        const { fakeBot } = createConsentBot();
        await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);
        await fireCallback(fakeBot, 'consent:agree');

        const captured = await fireContact(fakeBot, {
            phoneNumber: '+5543999998888',
            fromId: CITIZEN_CHAT_ID,
            contactUserId: 999
        });

        assert.equal(countSmsSubscribers(), 0);
        assert.match(captured.replied, /próprio/);
    });

    it('ignores a contact shared without going through the consent term', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireContact(fakeBot, { phoneNumber: '+5543999998888' });

        assert.equal(countSmsSubscribers(), 0);
        assert.match(captured.replied, /TERMO DE CONSENTIMENTO/);
    });

    it('rejects a foreign or malformed number without writing a row', async () => {
        const { fakeBot } = createConsentBot();
        await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);
        await fireCallback(fakeBot, 'consent:agree');

        const captured = await fireContact(fakeBot, { phoneNumber: '12345' });

        assert.equal(countSmsSubscribers(), 0);
        assert.match(captured.replied, /inválido|brasileiro/);
        // The consent stays pending so the user can share a valid number.
        const retry = await fireContact(fakeBot, { phoneNumber: '+5543999998888' });
        assert.equal(countSmsSubscribers(), 1);
        assert.match(retry.replied, /INSCRIÇÃO CONFIRMADA/);
    });

    it('records nothing when the user refuses the term', async () => {
        const { fakeBot } = createConsentBot();
        await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);

        const captured = await fireCallback(fakeBot, 'consent:decline');

        assert.equal(countSmsSubscribers(), 0);
        assert.match(captured.edited, /NENHUM DADO FOI ARMAZENADO/);
    });

    it('lets the user cancel between agreeing and sharing the number', async () => {
        const { fakeBot } = createConsentBot();
        await fireStart(fakeBot, SUBSCRIPTION_KEYWORD);
        await fireCallback(fakeBot, 'consent:agree');

        const captured = await fireText(fakeBot, CONSENT_CANCEL_LABEL);

        assert.equal(countSmsSubscribers(), 0);
        assert.match(captured.replies[0].replyText, /NENHUM DADO FOI ARMAZENADO/);
        assert.equal(captured.replies[0].options.reply_markup.remove_keyboard, true);
    });

    it('treats a second consent as an idempotent re-confirmation', async () => {
        const { fakeBot } = createConsentBot();

        await consentAndShare(fakeBot);
        const repeat = await consentAndShare(fakeBot, '5543999998888');

        assert.equal(countSmsSubscribers(), 1);
        assert.match(repeat.replied, /já está inscrito/i);
    });

    it('keeps the citizen away from administrator callbacks', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireCallback(fakeBot, 'menu:settings');

        assert.match(captured.replied, /Ver Últimos Alertas/);
        assert.equal(captured.edited, undefined);
    });
});

describe('Consent withdrawal (/sair)', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('removes the numbers this chat authorized and hides the keyboard', async () => {
        const { fakeBot } = createConsentBot();
        await consentAndShare(fakeBot);
        assert.equal(countSmsSubscribers(), 1);

        const captured = await fireCommand(fakeBot, 'sair');

        assert.match(captured.replied, /INSCRIÇÃO CANCELADA/);
        assert.equal(countSmsSubscribers(), 0);
        assert.equal(captured.replyOptions.reply_markup.remove_keyboard, true);
    });

    it('never removes numbers another chat authorized', async () => {
        const { fakeBot } = createConsentBot();
        await consentAndShare(fakeBot);

        const adminWithdrawal = await fireCommand(fakeBot, 'sair', { chatId: ADMIN_CHAT_ID });
        assert.match(adminWithdrawal.replied, /NENHUMA INSCRIÇÃO/);
        assert.equal(countSmsSubscribers(), 1);

        const citizenWithdrawal = await fireCommand(fakeBot, 'sair');
        assert.match(citizenWithdrawal.replied, /INSCRIÇÃO CANCELADA/);
        assert.equal(countSmsSubscribers(), 0);
    });

    it('reports a chat that never subscribed', async () => {
        const { fakeBot } = createConsentBot();

        const captured = await fireCommand(fakeBot, 'sair');

        assert.match(captured.replied, /NENHUMA INSCRIÇÃO/);
        assert.equal(countSmsSubscribers(), 0);
    });
});
