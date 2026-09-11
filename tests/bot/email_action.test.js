import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic (see tests/telegram.test.js): never touch the
// developer's real database file through the default database path.
process.env.DB_PATH = ':memory:';
import { TelegramBotClient } from '../../src/bot/telegram.js';
import { WeatherTelegramBot } from '../../src/bot/telegram_bot.js';
import { CARD_HEADER } from '../../src/bot/presentation.js';
import {
    buildAlertActionKeyboard,
    buildActiveAlertsKeyboard,
    buildEmailComposeKeyboard
} from '../../src/bot/keyboards.js';
import { DEFAULT_EMAIL_CUSTOM_MESSAGE } from '../../src/bot/email_templates.js';

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
 * Builds a bot instance with injected email seams (no real DB or SMTP).
 *
 * @param {object} [overrides] - Seam overrides.
 * @returns {{ bot: WeatherTelegramBot, fakeBot: object, emailService: object, emailStore: object, snapshot: object }} Test fixtures.
 */
function createEmailBot({ snapshotEvents = null, customMessage = DEFAULT_EMAIL_CUSTOM_MESSAGE, emailService = null } = {}) {
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
    let savedMessage = customMessage;
    const emailStore = {
        getCustomMessage: () => savedMessage,
        saveCustomMessage: message => {
            const text = String(message || '').trim();
            if (!text) return false;
            savedMessage = text;
            return true;
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
        emailService: fakeEmailService,
        emailStore,
        getSnapshot: () => snapshot
    });
    return { bot, fakeBot, emailService: fakeEmailService, emailStore, snapshot };
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

describe('Email comunicado keyboards', () => {
    it('exposes the email action on alert trays', () => {
        const alertKb = buildAlertActionKeyboard();
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:email_compose')));
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:active_alerts')));

        const activeKb = buildActiveAlertsKeyboard();
        assert.ok(activeKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:email_compose')));
    });

    it('builds the compose keyboard with send / edit / skip actions', () => {
        const kb = buildEmailComposeKeyboard(true);
        const flat = kb.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(flat.includes('action:email_send'));
        assert.ok(flat.includes('action:email_edit'));
        assert.ok(flat.includes('action:email_send_plain'));
        assert.ok(flat.includes('action:active_alerts'));

        const emptyKb = buildEmailComposeKeyboard(false);
        const emptyFlat = emptyKb.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(!emptyFlat.includes('action:email_send'));
        assert.ok(emptyFlat.includes('action:active_alerts'));
    });
});

describe('Email compose preview', () => {
    it('shows hazard summary, impacted zone, recipient, and the default message on first use', () => {
        const { bot } = createEmailBot();
        const compose = bot.renderEmailCompose();
        assert.equal(compose.canSend, true);
        assert.match(compose.text, /Tempestade severa/);
        assert.match(compose.text, /Charqueadas/);
        assert.match(compose.text, /Destinatário/);
        assert.match(compose.text, /comunidade acadêmica/);
    });

    it('shows the last saved message after an edit', () => {
        const { bot, emailStore } = createEmailBot();
        emailStore.saveCustomMessage('Aulas suspensas hoje à noite.');
        const compose = bot.renderEmailCompose();
        assert.match(compose.text, /Aulas suspensas hoje à noite/);
    });

    it('reports no active alerts when the snapshot is empty', () => {
        const { bot } = createEmailBot({ snapshotEvents: [] });
        const compose = bot.renderEmailCompose();
        assert.equal(compose.canSend, false);
        assert.match(compose.text, /Nenhum alerta ativo/);
    });
});

describe('Email send flow via admin buttons', () => {
    it('sends with the current message and renders the preview URL', async () => {
        const { bot, emailService } = createEmailBot();
        const result = await bot.sendAlertEmail({ withCustomMessage: true });
        assert.equal(result.ok, true);
        assert.match(result.subject, /Tempestade severa/);
        assert.equal(result.previewUrl, 'https://ethereal.email/message/test');
        assert.equal(emailService.sent.length, 1);
        assert.match(emailService.sent[0].mjml, /Tempestade severa/);
        assert.match(emailService.sent[0].mjml, /comunidade acadêmica/);
        assert.match(emailService.sent[0].text, /Charqueadas/);

        const text = WeatherTelegramBot.renderEmailResult(result);
        assert.match(text, /E-MAIL ENVIADO/);
        assert.match(text, /ethereal\.email/);
    });

    it('sends without the institution message when skipped', async () => {
        const { bot, emailService } = createEmailBot();
        const result = await bot.sendAlertEmail({ withCustomMessage: false });
        assert.equal(result.ok, true);
        assert.doesNotMatch(emailService.sent[0].mjml, /Comunicado da institui/);
        assert.doesNotMatch(emailService.sent[0].text, /COMUNICADO DA INSTITUI/);
    });

    it('contains mail failures instead of throwing', async () => {
        const { bot } = createEmailBot({
            emailService: { async send() { throw new Error('SMTP down'); } }
        });
        const result = await bot.sendAlertEmail({ withCustomMessage: true });
        assert.equal(result.ok, false);
        assert.match(result.error, /SMTP down/);
        assert.match(WeatherTelegramBot.renderEmailResult(result), /FALHA AO ENVIAR/);
    });

    it('rejects sending when no alerts are active', async () => {
        const { bot, emailService } = createEmailBot({ snapshotEvents: [] });
        const result = await bot.sendAlertEmail({ withCustomMessage: true });
        assert.equal(result.ok, false);
        assert.equal(emailService.sent.length, 0);
    });
});

describe('Email callback routing and message editing', () => {
    it('opens the compose preview from the email button', async () => {
        const { fakeBot } = createEmailBot();
        const captured = await fireCallback(fakeBot, 'action:email_compose');
        assert.match(captured.edited, /COMUNICADO POR E-MAIL/);
        assert.match(captured.edited, /Tempestade severa/);
        const flat = captured.options.reply_markup.inline_keyboard.flat().map(btn => btn.callback_data);
        assert.ok(flat.includes('action:email_send'));
    });

    it('edits the message through bot text: new custom becomes the default', async () => {
        const { fakeBot, bot, emailService } = createEmailBot();
        await fireCallback(fakeBot, 'action:email_edit');
        assert.ok(bot._emailEditPending.has('123'));

        const edited = 'Boa tarde comunidade academica. As aulas estão dispensadas no turno da noite de hoje.';
        const captured = await fireText(fakeBot, edited);
        assert.ok(!bot._emailEditPending.has('123'));
        assert.ok(captured.replies.some(r => r.replyText.includes('atualizada')));
        assert.ok(captured.replies.some(r => r.replyText.includes(edited)));

        const result = await bot.sendAlertEmail({ withCustomMessage: true });
        assert.match(emailService.sent[0].mjml, /dispensadas no turno da noite de hoje/);
    });

    it('sends via the send and skip buttons', async () => {
        const { fakeBot, emailService } = createEmailBot();
        const sent = await fireCallback(fakeBot, 'action:email_send');
        assert.match(sent.edited, /E-MAIL ENVIADO/);
        assert.match(sent.edited, /ethereal\.email/);

        const skipped = await fireCallback(fakeBot, 'action:email_send_plain');
        assert.match(skipped.edited, /E-MAIL ENVIADO/);
        assert.equal(emailService.sent.length, 2);
        assert.doesNotMatch(emailService.sent[1].mjml, /Comunicado da institui/);
    });

    it('denies the email flow to non-admin chats', async () => {
        const { fakeBot, emailService } = createEmailBot();
        const captured = await fireCallback(fakeBot, 'action:email_compose', { chatId: 999 });
        assert.equal(emailService.sent?.length || 0, 0);
        assert.match(captured.replied || '', /restrito ao administrador/);
    });

    it('keeps CARD_HEADER import used and template header intact', () => {
        assert.ok(CARD_HEADER.length > 0);
    });
});
