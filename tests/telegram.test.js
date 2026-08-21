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
    sendHighRiskAlerts,
    buildMainMenuKeyboard,
    buildSettingsKeyboard,
    buildIntervalKeyboard,
    buildRadiusKeyboard,
    buildAlertLevelKeyboard,
    ALERT_POLICIES
} from '../src/telegram_bot.js';

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

describe('Weather Telegram bot presentation & keyboards', () => {
    it('builds interactive button keyboards with expected options', () => {
        const mainKb = buildMainMenuKeyboard();
        assert.ok(mainKb);
        assert.ok(Array.isArray(mainKb.inline_keyboard));
        assert.ok(mainKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:status')));
        assert.ok(mainKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:settings')));

        const settingsKb = buildSettingsKeyboard();
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:interval')));
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:radius')));
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:alert_level')));

        const intervalKb = buildIntervalKeyboard(15);
        assert.ok(intervalKb.inline_keyboard.some(row => row.some(btn => btn.text.includes('15 min') && btn.text.includes('✅'))));

        const radiusKb = buildRadiusKeyboard(50);
        assert.ok(radiusKb.inline_keyboard.some(row => row.some(btn => btn.text.includes('50 km') && btn.text.includes('✅'))));

        const alertKb = buildAlertLevelKeyboard('school');
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'set_alert:school')));
    });

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

        assert.match(text, /ALERTA METEOROLÓGICO SEVERO/);
        assert.match(text, /CRITÉRIO: AVALIAÇÃO DE SUSPENSÃO DE AULAS/);
        assert.match(text, /Tempestade severa/);
        assert.match(text, /Charqueadas/);
        assert.match(text, /Alagamentos/);
    });

    it('handles interactive button navigation and runtime configuration adjustments', async () => {
        const { client, fakeBot } = createClient();
        let currentConfig = { radiusKm: 50, intervalMinutes: 15, intervalMs: 900000, alertPolicy: 'school' };

        const mockMonitor = {
            getConfig: () => currentConfig,
            updateConfig: update => {
                if (update.radiusKm) currentConfig.radiusKm = update.radiusKm;
                if (update.intervalMinutes) currentConfig.intervalMinutes = update.intervalMinutes;
                if (update.policy) currentConfig.alertPolicy = update.policy;
                return currentConfig;
            }
        };

        createWeatherTelegramBot({
            telegram: client,
            monitorService: mockMonitor
        });

        // 1. Test /start command renders main menu with keyboard
        let startReply = null;
        await fakeBot.commandHandlers.get('start')({
            chat: { id: 123 },
            reply: (msg, opts) => { startReply = { msg, opts }; }
        });
        assert.match(startReply.msg, /PAINEL METEOROLÓGICO/);
        assert.ok(startReply.opts?.reply_markup);

        // 2. Test callback query handler
        const callbackHandler = fakeBot.eventHandlers.get('callback_query:data');
        assert.ok(callbackHandler, 'Callback query handler must be registered');

        let edited = null;
        let answeredText = null;

        const fakeContext = data => ({
            chat: { id: 123 },
            callbackQuery: { data },
            answerCallbackQuery: opts => { answeredText = opts?.text; },
            editMessageText: (msg, opts) => { edited = { msg, opts }; }
        });

        // Click menu:settings
        await callbackHandler(fakeContext('menu:settings'));
        assert.match(edited.msg, /CONFIGURAÇÕES DO MONITOR/);

        // Click set_interval:30
        await callbackHandler(fakeContext('set_interval:30'));
        assert.strictEqual(currentConfig.intervalMinutes, 30);
        assert.match(answeredText, /Intervalo atualizado para 30 minutos/);

        // Click set_radius:75
        await callbackHandler(fakeContext('set_radius:75'));
        assert.strictEqual(currentConfig.radiusKm, 75);
        assert.match(answeredText, /Raio regional atualizado para 75 km/);

        // Click set_alert:red_only
        await callbackHandler(fakeContext('set_alert:red_only'));
        assert.strictEqual(currentConfig.alertPolicy, 'red_only');
        assert.match(answeredText, /Política de alerta atualizada/);

        // Click action:chatid
        await callbackHandler(fakeContext('action:chatid'));
        assert.match(edited.msg, /ID deste chat: 123/);
    });

    it('restricts status, commands, and buttons to configured administrators', async () => {
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
