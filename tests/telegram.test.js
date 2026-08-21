import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseTelegramAdminChatIds,
    parseTelegramConfig,
    splitTelegramMessage,
    TelegramBotClient,
    TELEGRAM_MAX_MESSAGE_LENGTH
} from '../src/telegram.js';
import {
    createWeatherTelegramBot,
    formatHighRiskAlert,
    sendHighRiskAlerts
} from '../src/telegram_bot.js';

function createFakeBot() {
    const bot = {
        commandHandlers: new Map(),
        eventHandlers: new Map(),
        sentMessages: [],
        command(command, handler) {
            this.commandHandlers.set(command, handler);
        },
        on(filter, handler) {
            this.eventHandlers.set(filter, handler);
        },
        catch(handler) {
            this.errorHandler = handler;
        },
        start: async options => {
            options?.onStart?.({ username: 'weather_test_bot' });
        },
        stop(reason) {
            this.stopReason = reason;
        }
    };
    bot.api = {
        sendMessage: async (chatId, text, options) => {
            bot.sentMessages.push({ chatId, text, options });
        }
    };
    return bot;
}

function createClient(adminChatIds = ['123']) {
    const fakeBot = createFakeBot();
    const client = new TelegramBotClient({
        token: 'test-token',
        adminChatIds,
        botFactory: () => fakeBot,
        logger: { error() {} }
    });
    return { client, fakeBot };
}

describe('Telegram configuration and wrapper', () => {
    it('parses and deduplicates administrator chat IDs', () => {
        assert.deepEqual(parseTelegramAdminChatIds('123, -100456,123'), ['123', '-100456']);
        assert.deepEqual(parseTelegramAdminChatIds(''), []);
        assert.throws(() => parseTelegramAdminChatIds('123,not-a-chat'), /Invalid Telegram administrator chat ID/);
    });

    it('requires token and administrator configuration for the bot entry point', () => {
        assert.deepEqual(parseTelegramConfig({
            env: {
                TELEGRAM_BOT_TOKEN: ' token ',
                TELEGRAM_ADMIN_CHAT_ID: '123,456'
            }
        }), {
            token: 'token',
            adminChatIds: ['123', '456']
        });

        assert.throws(() => parseTelegramConfig({ env: {} }), /TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID/);
    });

    it('splits outbound messages at Telegram’s maximum length', () => {
        const chunks = splitTelegramMessage('x'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH * 2 + 8));
        assert.deepEqual(chunks.map(chunk => chunk.length), [4096, 4096, 8]);

        const emojiChunks = splitTelegramMessage('😀'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 1));
        assert.strictEqual(emojiChunks[0], '😀'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH));
        assert.strictEqual(emojiChunks[1], '😀');
    });

    it('delivers every chunk to every configured administrator', async () => {
        const { client, fakeBot } = createClient(['123', '456']);

        const result = await client.sendToAdmins('x'.repeat(4100));

        assert.deepEqual(result.sent, [
            { chatId: '123', chunks: 2 },
            { chatId: '456', chunks: 2 }
        ]);
        assert.deepEqual(result.failed, []);
        assert.strictEqual(fakeBot.sentMessages.length, 4);
        assert.ok(client.isAdminChat(123));
        assert.strictEqual(client.isAdminChat(999), false);
    });
});

describe('Weather Telegram bot', () => {
    it('formats high-risk events with the fields needed by an administrator', () => {
        const text = formatHighRiskAlert([
            {
                emoji: '🔴',
                type: 'Tempestade severa',
                severity: 'Grande Perigo',
                source: 'INMET_OFFICIAL_WARNING',
                affectedCities: ['Charqueadas'],
                timeframe: 'Agora -> 22:00',
                triggerReason: 'Alerta oficial do INMET',
                details: 'Alagamentos'
            }
        ], new Date('2026-08-13T12:00:00Z'));

        assert.match(text, /ALERTA METEOROLÓGICO DE ALTO RISCO/);
        assert.match(text, /Tempestade severa/);
        assert.match(text, /Charqueadas/);
        assert.match(text, /Alagamentos/);
    });

    it('restricts status and unknown-message handling to configured administrators', async () => {
        const { client, fakeBot } = createClient();
        createWeatherTelegramBot({
            telegram: client,
            getStatus: () => 'STATUS OK'
        });

        const adminReplies = [];
        await fakeBot.commandHandlers.get('status')({
            chat: { id: 123 },
            reply: message => adminReplies.push(message)
        });
        assert.deepEqual(adminReplies, ['STATUS OK']);

        const unknownReplies = [];
        await fakeBot.eventHandlers.get('message:text')({
            chat: { id: 999 },
            reply: message => unknownReplies.push(message)
        });
        assert.match(unknownReplies[0], /restrito ao administrador/);
    });

    it('returns the delivery summary for a formatted alert', async () => {
        const { client, fakeBot } = createClient();
        const result = await sendHighRiskAlerts(client, [{
            type: 'Teste',
            affectedCities: ['Charqueadas']
        }], new Date('2026-08-13T12:00:00Z'));

        assert.deepEqual(result.sent, [{ chatId: '123', chunks: 1 }]);
        assert.strictEqual(fakeBot.sentMessages[0].chatId, '123');
        assert.match(fakeBot.sentMessages[0].text, /Teste/);
    });
});
