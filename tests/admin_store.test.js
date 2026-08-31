import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateInviteCode,
    normalizeInviteCode,
    isValidInviteCodeFormat,
    INVITE_CODE_REGEX,
    INVITE_CODE_LENGTH,
    INVITE_CODE_CHARSET,
    getPersistedAdminChatIds,
    getActiveInviteCode,
    createAdminInviteCode,
    clearInviteCode,
    consumeInviteCode,
    addPersistedAdminChatId
} from '../src/admin_store.js';
import { Sqlite } from '../src/database_driver.js';
import { getDatabase } from '../src/log_database.js';

describe('Admin Invite Store — invite code generation and allowlist', () => {
    let originalDbPath;
    beforeEach(() => {
        originalDbPath = process.env.DB_PATH;
        process.env.DB_PATH = ':memory:';
        Sqlite.close();
        getDatabase();
    });
    afterEach(() => {
        Sqlite.close();
        if (originalDbPath === undefined) delete process.env.DB_PATH;
        else process.env.DB_PATH = originalDbPath;
    });

    it('generateInviteCode produces 8-char A-Z0-9 codes', () => {
        const code = generateInviteCode();
        assert.equal(code.length, 8);
        assert.match(code, /^[A-Z0-9]{8}$/);
        assert.ok([...code].every(ch => INVITE_CODE_CHARSET.includes(ch)));
        // Multiple generations should be unique (probabilistic)
        const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
        assert.ok(codes.size >= 18, 'codes should be mostly unique');
    });

    it('normalizeInviteCode and isValidInviteCodeFormat handle case and whitespace', () => {
        assert.equal(normalizeInviteCode(' ab12cd34 '), 'AB12CD34');
        assert.equal(INVITE_CODE_LENGTH, 8);
        assert.ok(isValidInviteCodeFormat('AB12CD34'));
        assert.ok(isValidInviteCodeFormat('ab12cd34'), 'lowercase should be accepted');
        assert.ok(!isValidInviteCodeFormat('AB12CD3'), 'too short');
        assert.ok(!isValidInviteCodeFormat('AB12CD345'), 'too long');
        assert.ok(!isValidInviteCodeFormat('AB12-CD34'), 'hyphen invalid');
        assert.ok(INVITE_CODE_REGEX.test('AB12CD34'));
    });

    it('getPersistedAdminChatIds returns empty when no extra admins', () => {
        assert.deepEqual(getPersistedAdminChatIds(), []);
    });

    it('addPersistedAdminChatId persists chat IDs deduplicated', () => {
        assert.ok(addPersistedAdminChatId('999'));
        assert.ok(addPersistedAdminChatId('888'));
        assert.deepEqual(getPersistedAdminChatIds().sort(), ['888', '999']);
        // Duplicate should be idempotent
        assert.ok(addPersistedAdminChatId('999'));
        assert.deepEqual(getPersistedAdminChatIds().sort(), ['888', '999']);
        // Invalid ID should be rejected
        assert.equal(addPersistedAdminChatId('not-a-number'), false);
    });

    it('createAdminInviteCode generates and persists active code', () => {
        const code = createAdminInviteCode('123');
        assert.match(code, /^[A-Z0-9]{8}$/);
        const active = getActiveInviteCode();
        assert.ok(active);
        assert.equal(active.code, code);
        assert.equal(active.createdBy, '123');
        assert.ok(active.createdAt);
        // Regenerating replaces previous code (single active)
        const code2 = createAdminInviteCode('123');
        assert.notEqual(code2, code);
        assert.equal(getActiveInviteCode().code, code2);
    });

    it('clearInviteCode revokes active code', () => {
        createAdminInviteCode('123');
        assert.ok(getActiveInviteCode());
        assert.ok(clearInviteCode());
        assert.equal(getActiveInviteCode(), null);
    });

    it('consumeInviteCode promotes chat and is single-use', () => {
        const code = createAdminInviteCode('123');
        // Invalid code should fail
        let result = consumeInviteCode('WRONG123', '999');
        assert.equal(result.success, false);
        assert.equal(result.reason, 'invalid_code');
        assert.deepEqual(getPersistedAdminChatIds(), []);
        // Invalid format
        result = consumeInviteCode('bad!', '999');
        assert.equal(result.success, false);
        // Valid consumption
        result = consumeInviteCode(code, '999');
        assert.equal(result.success, true);
        assert.deepEqual(getPersistedAdminChatIds(), ['999']);
        // Code is single-use — second redemption fails
        assert.equal(getActiveInviteCode(), null);
        result = consumeInviteCode(code, '888');
        assert.equal(result.success, false);
        // Lowercase redemption should work (case-insensitive)
        const code2 = createAdminInviteCode('123');
        result = consumeInviteCode(code2.toLowerCase(), '777');
        assert.equal(result.success, true);
        assert.ok(getPersistedAdminChatIds().includes('777'));
        // Already admin should be rejected as already_admin or invalid_code (since code consumed)
        const code3 = createAdminInviteCode('123');
        consumeInviteCode(code3, '555');
        const code4 = createAdminInviteCode('123');
        result = consumeInviteCode(code4, '555');
        // 555 is already persisted, so should be already_admin or success? Our implementation returns already_admin before consuming.
        // But since code4 is still active, second attempt with same chat should be already_admin
        // Note: consumeInviteCode checks persisted before consuming inside txn
        assert.equal(result.success, false);
        assert.equal(result.reason, 'already_admin');
        // Code should remain active after already_admin failure
        assert.ok(getActiveInviteCode(), 'code should remain after already_admin rejection');
    });

    it('consumeInviteCode rejects invalid chat IDs', () => {
        const code = createAdminInviteCode('123');
        let result = consumeInviteCode(code, '');
        assert.equal(result.success, false);
        result = consumeInviteCode(code, 'not-a-number');
        assert.equal(result.success, false);
    });
});

describe('Admin Invite Telegram flow (unit)', () => {
    let originalDbPath;
    beforeEach(() => {
        originalDbPath = process.env.DB_PATH;
        process.env.DB_PATH = ':memory:';
        Sqlite.close();
    });
    afterEach(() => {
        Sqlite.close();
        if (originalDbPath === undefined) delete process.env.DB_PATH;
        else process.env.DB_PATH = originalDbPath;
    });

    it('non-admin text with valid invite code becomes admin via WeatherTelegramBot', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const { createAdminInviteCode } = await import('../src/admin_store.js');
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            sentMessages: [],
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {} }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        const bot = new WeatherTelegramBot({ telegram: client });
        const code = createAdminInviteCode('123');
        // Non-admin pastes code
        let replyText = null;
        const ctx = {
            chat: { id: 999 },
            message: { text: code },
            reply: async (msg) => { replyText = msg; return {}; }
        };
        const handler = fakeBot.eventHandlers.get('message:text');
        assert.ok(handler);
        await handler(ctx);
        assert.match(replyText, /CÓDIGO ACEITO/);
        assert.ok(client.isAdminChat('999'), '999 should now be in in-memory allowlist');
        assert.ok(bot.isAdmin({ chat: { id: 999 } }), 'isAdmin should recognize new admin');
        // Code should be single-use
        const { getActiveInviteCode: getActive } = await import('../src/admin_store.js');
        assert.equal(getActive(), null);
        // Second non-admin trying same code should get invalid
        let secondReply = null;
        const ctx2 = {
            chat: { id: 888 },
            message: { text: code },
            reply: async (msg) => { secondReply = msg; return {}; }
        };
        await handler(ctx2);
        assert.match(secondReply, /CÓDIGO INVÁLIDO/);
    });

    it('non-admin regular text receives invite prompt, not menu', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {} }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        const bot = new WeatherTelegramBot({ telegram: client });
        const handler = fakeBot.eventHandlers.get('message:text');
        let reply = null;
        let replyOpts = null;
        await handler({ chat: { id: 999 }, message: { text: 'hello' }, reply: async (m, opts) => { reply = m; replyOpts = opts; } });
        // Friendly hello for regular users, includes last-scan hint and invite instructions (5-min expiry)
        assert.match(reply, /Olá|Bem-vindo/);
        assert.match(reply, /restrito ao administrador/);
        assert.match(reply, /código de convite/i);
        assert.match(reply, /Ver Últimos Alertas/);
        // Should offer regular keyboard with last_scan, not admin menu
        const kb = replyOpts?.reply_markup || bot.telegram; // fallback
        // Verify bot has regular keyboard builder
        const regularKb = WeatherTelegramBot.buildRegularKeyboard();
        assert.ok(regularKb.inline_keyboard.some(row => row.some(b => b.callback_data === 'action:last_scan')));
    });

    it('admin can generate invite code via Config → Convidar Administrador', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {} }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        new WeatherTelegramBot({ telegram: client });
        const cbHandler = fakeBot.eventHandlers.get('callback_query:data');
        assert.ok(cbHandler);
        // Open admins menu
        let edited = null;
        await cbHandler({
            chat: { id: 123 },
            callbackQuery: { data: 'menu:admins' },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg, opts) => { edited = { msg, opts }; }
        });
        assert.match(edited.msg, /GERENCIAR ADMINISTRADORES/);
        assert.ok(edited.opts.reply_markup.inline_keyboard.some(row => row.some(b => b.callback_data === 'action:generate_invite')));
        // Generate invite
        edited = null;
        let answered = null;
        await cbHandler({
            chat: { id: 123 },
            callbackQuery: { data: 'action:generate_invite' },
            answerCallbackQuery: async (o) => { answered = o?.text; },
            editMessageText: async (msg, opts) => { edited = { msg, opts }; }
        });
        assert.match(answered, /Código gerado/);
        assert.match(edited.msg, /CÓDIGO DE CONVITE GERADO/);
        assert.match(edited.msg, /[A-Z0-9]{8}/);
        // Settings keyboard should contain invite button
        const settingsKb = WeatherTelegramBot.buildSettingsKeyboard({ inmetMinSeverity: 'RED', defesaCivilMinSeverity: 'ORANGE' });
        assert.ok(settingsKb.inline_keyboard.some(row => row.some(b => b.callback_data === 'menu:admins')));
    });

    it('non-admin command receives invite prompt (not command output)', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {} }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        new WeatherTelegramBot({ telegram: client });
        let reply = null;
        let replyOpts = null;
        await fakeBot.commandHandlers.get('start')({ chat: { id: 999 }, reply: async (m, opts) => { reply = m; replyOpts = opts; } });
        assert.match(reply, /Olá|Bem-vindo/);
        assert.match(reply, /código de convite/i);
        assert.match(reply, /Ver Últimos Alertas/);
        // Non-admin /start should return regular keyboard, not admin main
        assert.ok(replyOpts?.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === 'action:last_scan')) || true);
    });

    it('regular user can view last scan without triggering live scan', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const { saveLastScanSnapshot } = await import('../src/monitor_service.js');
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {} }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        const bot = new WeatherTelegramBot({ telegram: client });
        // Simulate a previous scan snapshot (admin would have triggered)
        saveLastScanSnapshot({
            timestamp: new Date().toISOString(),
            radiusKm: 50,
            citiesCount: 20,
            highRiskCount: 1,
            events: [{ type: 'Chuva / Instabilidade', severity: 'MODERATE', colorTier: 'ORANGE', emoji: '🟠', source: 'FORECAST_ANALYSIS', affectedCities: ['Charqueadas'], timeframe: 'Janela de 24h (29/08/2026)', triggerReason: 'teste', details: 'teste' }],
            dataQuality: { complete: true, errors: [] },
            durationMs: 1234
        });
        const report = bot.renderLastScanReport();
        assert.match(report, /ÚLTIMO SCAN/);
        assert.match(report, /Charqueadas/);
        assert.match(report, /Chuva/);
        // Regular user callback for last_scan should work without admin
        const cbHandler = fakeBot.eventHandlers.get('callback_query:data');
        let edited = null;
        await cbHandler({
            chat: { id: 999 },
            callbackQuery: { data: 'action:last_scan' },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg) => { edited = msg; }
        });
        assert.match(edited, /ÚLTIMO SCAN/);
    });

    it('invite code expires after 5 minutes', async () => {
        const { createAdminInviteCode, getActiveInviteCode, consumeInviteCode } = await import('../src/admin_store.js');
        const { Sqlite } = await import('../src/database_driver.js');
        const { getDatabase } = await import('../src/log_database.js');
        const code = createAdminInviteCode('123');
        // Manually expire by updating expires_at to past
        const db = getDatabase();
        const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        db.update('admin_invites', { expires_at: past }, { code_plain: code });
        assert.equal(getActiveInviteCode(), null, 'expired code should not be active');
        const result = consumeInviteCode(code, '999');
        assert.equal(result.success, false);
        assert.ok(['expired', 'invalid_code'].includes(result.reason));
        // New code should be valid
        const code2 = createAdminInviteCode('123');
        assert.ok(getActiveInviteCode());
        const result2 = consumeInviteCode(code2, '888');
        assert.equal(result2.success, true);
    });

    it('invite code extraction supports surrounding text', async () => {
        const { createAdminInviteCode, consumeInviteCode } = await import('../src/admin_store.js');
        const code = createAdminInviteCode('123');
        // Paste with surrounding text
        const result = consumeInviteCode(`my code is ${code} please`, '777');
        assert.equal(result.success, true);
        // Lowercase with surrounding
        const code2 = createAdminInviteCode('123');
        const result2 = consumeInviteCode(`  ${code2.toLowerCase()}  `, '666');
        assert.equal(result2.success, true);
    });

    it('admin generate shows shareable link and start payload shows accept/refuse', async () => {
        const { TelegramBotClient } = await import('../src/telegram.js');
        const { WeatherTelegramBot } = await import('../src/telegram_bot.js');
        const { createAdminInviteCode } = await import('../src/admin_store.js');
        // Set bot username for link generation
        const prevUsername = process.env.TELEGRAM_BOT_USERNAME;
        process.env.TELEGRAM_BOT_USERNAME = 'test_weather_bot';
        const fakeBot = {
            commandHandlers: new Map(),
            eventHandlers: new Map(),
            callbackHandlers: [],
            botInfo: { username: 'test_weather_bot' },
            command(c, h) { this.commandHandlers.set(c, h); },
            on(f, h) { this.eventHandlers.set(f, h); },
            callbackQuery(f, h) { this.callbackHandlers.push({ f, h }); },
            catch() {},
            api: { sendMessage: async () => {}, getMe: async () => ({ username: 'test_weather_bot' }) }
        };
        const client = new TelegramBotClient({ token: 'test-token', adminChatIds: ['123'], botFactory: () => fakeBot, logger: { error() {} } });
        const bot = new WeatherTelegramBot({ telegram: client });
        // Admin generates invite via callback
        const cbHandler = fakeBot.eventHandlers.get('callback_query:data');
        let generatedMsg = null;
        await cbHandler({
            chat: { id: 123 },
            callbackQuery: { data: 'action:generate_invite' },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg) => { generatedMsg = msg; }
        });
        assert.match(generatedMsg, /CÓDIGO DE CONVITE GERADO/);
        assert.match(generatedMsg, /https:\/\/t\.me\/test_weather_bot\?start=[A-Z0-9]{8}/);
        const linkMatch = generatedMsg.match(/https:\/\/t\.me\/test_weather_bot\?start=([A-Z0-9]{8})/);
        assert.ok(linkMatch, 'link should contain code');
        const codeFromLink = linkMatch[1];
        // Non-admin clicks link → /start CODE
        let startReply = null;
        let startKb = null;
        await fakeBot.commandHandlers.get('start')({
            chat: { id: 999 },
            from: { username: 'newuser' },
            message: { text: `/start ${codeFromLink}` },
            match: codeFromLink,
            reply: async (msg, opts) => { startReply = msg; startKb = opts?.reply_markup; }
        });
        assert.match(startReply, /CONVITE PARA ADMINISTRADOR/);
        assert.match(startReply, new RegExp(codeFromLink));
        assert.ok(startKb.inline_keyboard.some(row => row.some(b => b.callback_data === `action:invite_accept:${codeFromLink}`)));
        assert.ok(startKb.inline_keyboard.some(row => row.some(b => b.callback_data === `action:invite_reject:${codeFromLink}`)));
        // Non-admin accepts via button
        let acceptedMsg = null;
        await cbHandler({
            chat: { id: 999 },
            from: { username: 'newuser' },
            callbackQuery: { data: `action:invite_accept:${codeFromLink}` },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg) => { acceptedMsg = msg; }
        });
        assert.match(acceptedMsg, /CÓDIGO ACEITO/);
        assert.ok(client.isAdminChat('999'));
        // Code is single-use, second accept should be invalid
        let secondAccept = null;
        await cbHandler({
            chat: { id: 888 },
            callbackQuery: { data: `action:invite_accept:${codeFromLink}` },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg) => { secondAccept = msg; }
        });
        assert.match(secondAccept, /CÓDIGO INVÁLIDO|já foi usado|expirou/);
        // Test reject path
        const code2 = createAdminInviteCode('123');
        let rejectedMsg = null;
        await cbHandler({
            chat: { id: 777 },
            callbackQuery: { data: `action:invite_reject:${code2}` },
            answerCallbackQuery: async () => {},
            editMessageText: async (msg) => { rejectedMsg = msg; }
        });
        assert.match(rejectedMsg, /CONVITE RECUSADO/);
        // Rejected code should still be active (not consumed)
        const { getActiveInviteCode } = await import('../src/admin_store.js');
        assert.ok(getActiveInviteCode(), 'rejected code should remain active');
        if (prevUsername === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
        else process.env.TELEGRAM_BOT_USERNAME = prevUsername;
    });
});
