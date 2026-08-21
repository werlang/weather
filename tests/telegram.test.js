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
    WeatherTelegramBot,
    INMET_SEVERITY_OPTIONS,
    DEFESA_CIVIL_SEVERITY_OPTIONS
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
    it('builds interactive button keyboards with expected independent institute options', () => {
        const mainKb = WeatherTelegramBot.buildMainMenuKeyboard();
        assert.ok(mainKb);
        assert.ok(Array.isArray(mainKb.inline_keyboard));
        assert.ok(mainKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:status')));
        assert.ok(mainKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:settings')));

        // Settings buttons must show the current color circle of each provider.
        const settingsKb = WeatherTelegramBot.buildSettingsKeyboard({
            inmetMinSeverity: 'RED',
            defesaCivilMinSeverity: 'ORANGE'
        });
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:interval')));
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:radius')));
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:inmet_level' && btn.text.includes('🔴 Vermelho'))));
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:defesa_civil_level' && btn.text.includes('🟠 Laranja'))));

        const intervalKb = WeatherTelegramBot.buildIntervalKeyboard(15);
        assert.ok(intervalKb.inline_keyboard.some(row => row.some(btn => btn.text.includes('15 min') && btn.text.includes('✅'))));

        const radiusKb = WeatherTelegramBot.buildRadiusKeyboard(50);
        assert.ok(radiusKb.inline_keyboard.some(row => row.some(btn => btn.text.includes('50 km') && btn.text.includes('✅'))));

        const inmetKb = WeatherTelegramBot.buildInmetLevelKeyboard('RED');
        assert.ok(inmetKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'set_inmet:RED' && btn.text.includes('✅'))));
        assert.ok(inmetKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'set_inmet:OFF')));

        const dcKb = WeatherTelegramBot.buildDefesaCivilLevelKeyboard('ORANGE');
        assert.ok(dcKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'set_dc:ORANGE' && btn.text.includes('✅'))));
        assert.ok(dcKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'set_dc:OFF')));

        // Defesa Civil threat levels are ordered from most to least severe.
        assert.deepEqual(DEFESA_CIVIL_SEVERITY_OPTIONS.map(opt => opt.id), ['RED', 'ORANGE', 'YELLOW', 'OFF']);
    });

    it('formats high-risk events with the fields needed by an administrator', () => {
        const text = WeatherTelegramBot.formatHighRiskAlert([
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
        assert.match(text, /Grande Perigo/i);
    });

    it('builds alert action tray and renders UI visual components properly', async () => {
        const { renderProgressBar, renderRiverTrend, renderSeverityBadge, BOT_COMMANDS } = await import('../src/telegram_bot.js');

        // Progress meter / gauge tests
        assert.strictEqual(renderProgressBar(2.5, 5.0, 8), '[████░░░░] 50%');
        assert.strictEqual(renderProgressBar(5.0, 5.0, 8), '[████████] 100%');
        assert.strictEqual(renderProgressBar(0, 5.0, 8), '[░░░░░░░░] 0%');
        assert.strictEqual(renderProgressBar(null, 5.0, 8), '[░░░░░░░░]');

        // River trend indicators
        assert.match(renderRiverTrend(0.35), /Subida Crítica/);
        assert.match(renderRiverTrend(0.12), /Subindo/);
        assert.match(renderRiverTrend(0), /Estável/);
        assert.match(renderRiverTrend(-0.15), /Descendo/);
        assert.strictEqual(renderRiverTrend(null), '');

        // Severity badge
        assert.match(renderSeverityBadge('Grande Perigo'), /🔴 GRANDE PERIGO/);
        assert.match(renderSeverityBadge('Perigo'), /🟠 PERIGO/);
        assert.match(renderSeverityBadge('Perigo Potencial'), /🟡 PERIGO POTENCIAL/);
        assert.match(renderSeverityBadge('Normal'), /🟢 NORMAL/);

        // Alert action keyboard
        const alertKb = WeatherTelegramBot.buildAlertActionKeyboard();
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:defesa_civil')));
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'action:inmet_warnings')));
        assert.ok(alertKb.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'menu:main')));

        // Command definitions
        assert.ok(Array.isArray(BOT_COMMANDS));
        assert.ok(BOT_COMMANDS.some(c => c.command === 'start'));
        assert.ok(BOT_COMMANDS.some(c => c.command === 'jacui'));
        assert.ok(BOT_COMMANDS.some(c => c.command === 'inmet'));
    });

    it('registers bot commands with Telegram API menu autocomplete', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const fakeBot = createFakeBot();
        let registeredCommands = null;
        fakeBot.api.setMyCommands = async cmds => { registeredCommands = cmds; };

        const client = new TelegramBotClient({
            token: 'test-token',
            adminChatIds: ['123'],
            botFactory: () => fakeBot,
            logger: { warn() {} }
        });

        const bot = new WeatherTelegramBot({ telegram: client });
        const ok = await bot.initCommands();
        assert.strictEqual(ok, true);
        assert.ok(Array.isArray(registeredCommands));
        assert.strictEqual(registeredCommands.length, 8);
    });

    it('handles interactive button navigation and independent institute adjustments', async () => {
        const { client, fakeBot } = createClient();
        let currentConfig = {
            radiusKm: 50,
            intervalMinutes: 15,
            intervalMs: 900000,
            inmetMinSeverity: 'RED',
            defesaCivilMinSeverity: 'ORANGE'
        };

        const mockMonitor = {
            getConfig: () => currentConfig,
            updateConfig: update => {
                if (update.radiusKm) currentConfig.radiusKm = update.radiusKm;
                if (update.intervalMinutes) currentConfig.intervalMinutes = update.intervalMinutes;
                if (update.inmetMinSeverity) currentConfig.inmetMinSeverity = update.inmetMinSeverity;
                if (update.defesaCivilMinSeverity) currentConfig.defesaCivilMinSeverity = update.defesaCivilMinSeverity;
                return currentConfig;
            }
        };

        new WeatherTelegramBot({
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

        // Click menu:inmet_level
        await callbackHandler(fakeContext('menu:inmet_level'));
        assert.match(edited.msg, /LIMIAR MÍNIMO DE ALERTA — INMET/);

        // Click set_inmet:ORANGE
        await callbackHandler(fakeContext('set_inmet:ORANGE'));
        assert.strictEqual(currentConfig.inmetMinSeverity, 'ORANGE');
        assert.match(answeredText, /Limiar INMET atualizado/);

        // Click menu:defesa_civil_level
        await callbackHandler(fakeContext('menu:defesa_civil_level'));
        assert.match(edited.msg, /LIMIAR MÍNIMO DE ALERTA — DEFESA CIVIL RS/);

        // Click set_dc:RED
        await callbackHandler(fakeContext('set_dc:RED'));
        assert.strictEqual(currentConfig.defesaCivilMinSeverity, 'RED');
        assert.match(answeredText, /Limiar Defesa Civil atualizado/);

        // Click action:chatid
        await callbackHandler(fakeContext('action:chatid'));
        assert.match(edited.msg, /ID deste chat: 123/);
    });

    it('restricts status, commands, and buttons to configured administrators', async () => {
        const { client, fakeBot } = createClient();
        new WeatherTelegramBot({
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
        const bot = new WeatherTelegramBot({ telegram: client });
        const result = await bot.sendHighRiskAlerts([{
            type: 'Teste',
            affectedCities: ['Charqueadas']
        }], new Date('2026-08-13T12:00:00Z'));

        assert.deepEqual(result.sent, [{ chatId: '123', chunks: 1 }]);
        assert.strictEqual(fakeBot.sentMessages[0].chatId, '123');
        assert.match(fakeBot.sentMessages[0].text, /Teste/);
    });
});
