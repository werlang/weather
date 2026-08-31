/**
 * Telegram Bot Presentation & Interactive UI Layer.
 * Provides an object-oriented WeatherTelegramBot class managing interactive menus,
 * inline button keyboards, high-contrast cards, and alert delivery.
 * 
 * Supports independent alert thresholds for INMET and DEFESA CIVIL RS.
 * 
 * @module telegramBot
 */

import { InlineKeyboard, splitTelegramMessage } from './telegram.js';
import { onHighRiskEventDetected, parseMonitorConfig, performRegionalRiskMonitoring, getLastScanSnapshot } from './monitor_service.js';
import { getFetchStats, saveSystemSetting } from './log_database.js';
import { aggregateRiskEvents, normalizeSeverityTier, ALERT_CATEGORIES } from './risk_analyzer.js';
import {
    INVITE_CODE_REGEX,
    normalizeInviteCode,
    extractInviteCodeFromText,
    getActiveInviteCode,
    createAdminInviteCode,
    consumeInviteCode,
    getPersistedAdminChatIds,
    addPersistedAdminChatId,
    clearInviteCode
} from './admin_store.js';


/**
 * Unicode visual divider constants for high-contrast card UI.
 */
export const CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const CARD_DIVIDER = '─────────────────────────';




/**
 * INMET independent severity options.
 */
export const INMET_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Grande Perigo)', desc: 'Apenas alertas extremos com risco à vida e bens.' },
    { id: 'ORANGE', label: '🟠 Laranja (Perigo) ou superior', desc: 'Inclui tempestades e chuvas intensas moderadas/severas.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Perigo Potencial) ou superior', desc: 'Modo informativo amplo para qualquer aviso.' },
    { id: 'OFF', label: '🚫 Desativar Alertas INMET', desc: 'Não emite alertas automáticos originados do INMET.' }
];

/**
 * Defesa Civil RS independent severity options.
 */
export const DEFESA_CIVIL_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Alerta Máximo)', desc: 'Precipitação torrencial extrema e inundações iminentes.' },
    { id: 'ORANGE', label: '🟠 Laranja (Alerta / Severo) ou superior', desc: 'Chuva >= 30mm/h, ventos >= 75km/h, subida rápida do Jacuí.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Atenção) ou superior', desc: 'Chuva moderada >= 15mm/h ou ventos >= 50km/h.' },
    { id: 'OFF', label: '🚫 Desativar Alertas Defesa Civil', desc: 'Não emite alertas automáticos da Defesa Civil RS.' }
];

/**
 * Alert-category independent severity options (same 4-tier model as institutes).
 */
export const CATEGORY_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Grande Perigo)', desc: 'Apenas eventos críticos com risco elevado.' },
    { id: 'ORANGE', label: '🟠 Laranja (Perigo) ou superior', desc: 'Inclui eventos moderados a severos.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Perigo Potencial) ou superior', desc: 'Modo informativo para qualquer severidade.' },
    { id: 'OFF', label: '🚫 Desativado', desc: 'Silencia todos os alertas desta categoria.' }
];

/**
 * Formats a severity tier into a readable emoji badge.
 * 
 * @param {string} tier 
 * @returns {string}
 */
export function getTierBadge(tier) {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === 'RED') return '🔴 Vermelho (Grande Perigo)';
    if (normalized === 'ORANGE') return '🟠 Laranja (Alerta / Perigo)';
    if (normalized === 'YELLOW') return '🟡 Amarelo (Atenção / Potencial)';
    return '🚫 Desativado';
}


/**
 * Maps a severity tier to its short colored circle badge for compact menu buttons.
 *
 * @param {string} tier
 * @returns {string}
 */
export function getTierShortBadge(tier) {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === 'RED') return '🔴 Vermelho';
    if (normalized === 'ORANGE') return '🟠 Laranja';
    if (normalized === 'YELLOW') return '🟡 Amarelo';
    return '🚫 Desativado';
}


/**
 * Standard Telegram Bot command menu definition for autocomplete.
 */
export const BOT_COMMANDS = [
    { command: 'start', description: '🌤️ Painel meteorológico e menu interativo' },
    { command: 'menu', description: '🌤️ Abrir painel principal' },
    { command: 'status', description: '📊 Status do monitor e do banco de dados' },
    { command: 'alertas', description: '🚨 Avisos e alertas ativos (INMET + Defesa Civil RS)' },
    { command: 'config', description: '⚙️ Ajustes de intervalo, raio e alertas' },
    { command: 'help', description: '📖 Ajuda e guia operacional' }
];

/**
 * Maps a severity string or canonical tier to a high-contrast visual badge.
 * Understands Portuguese severity names, canonical tiers (RED/ORANGE/YELLOW),
 * and the analyzer's English gradings (HIGH/MODERATE/LOW).
 *
 * @param {string} severity
 * @returns {string}
 */
export function renderSeverityBadge(severity = '') {
    const lower = String(severity).toLowerCase();
    const upper = String(severity).toUpperCase();
    if (upper === 'UNKNOWN' || lower.includes('não classificad')) {
        return '❓ DESCONHECIDO — REVISAR';
    }
    if (upper === 'RED' || lower.includes('grande perigo') || lower.includes('máximo') || lower.includes('extremo') || lower.includes('red') || lower.includes('high')) {
        return '🔴 GRANDE PERIGO (CRÍTICO)';
    }
    if (upper === 'YELLOW' || lower.includes('potencial') || lower.includes('amarelo') || lower.includes('yellow') || lower.includes('atenção') || lower.includes('low')) {
        return '🟡 PERIGO POTENCIAL (MODERADO)';
    }
    if (upper === 'ORANGE' || lower.includes('perigo') || lower.includes('laranja') || lower.includes('orange') || lower.includes('alerta') || lower.includes('moderate')) {
        return '🟠 PERIGO (SEVERO)';
    }
    return '🟢 NORMAL / MONITORAMENTO';
}

/**
 * Resolves an event's canonical alert tier for the message-level presentation.
 *
 * @param {object} event - Normalized risk event.
 * @returns {'OFF'|'YELLOW'|'ORANGE'|'RED'} Canonical tier.
 */
function getEventAlertTier(event = {}) {
    if (String(event.colorTier || '').toUpperCase() === 'UNKNOWN') return 'RED';
    const normalizedTier = normalizeSeverityTier(event.colorTier);
    if (normalizedTier !== 'OFF') return normalizedTier;

    const severity = String(event.severity || '').toLowerCase();
    if (severity.includes('unknown') || severity.includes('não classificada')) return 'RED';
    if (severity.includes('high') || severity.includes('red') || severity.includes('grande perigo') || severity.includes('extremo')) {
        return 'RED';
    }
    if (severity.includes('orange') || severity.includes('laranja') || severity.includes('perigo') || severity.includes('alerta')) {
        return severity.includes('potencial') ? 'YELLOW' : 'ORANGE';
    }
    if (severity.includes('yellow') || severity.includes('amarelo') || severity.includes('moderate') || severity.includes('moderado')) {
        return 'YELLOW';
    }
    return 'OFF';
}

/**
 * Selects wording that matches the highest severity in an alert batch.
 *
 * @param {Array<object>} events - Normalized risk events.
 * @returns {{ header: string, criteria: string, footer: string }} Alert copy.
 */
function getAlertPresentation(events) {
    const rank = { OFF: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
    const highestTier = (Array.isArray(events) ? events : [])
        .map(getEventAlertTier)
        .sort((left, right) => rank[right] - rank[left])[0] || 'OFF';

    if (highestTier === 'RED') {
        return {
            header: '🚨 ALERTA METEOROLÓGICO SEVERO',
            criteria: '🏫 CRITÉRIO: AVALIAÇÃO DE SUSPENSÃO DE AULAS / ATIVIDADES',
            footer: '⚠️ Recomenda-se acionar o plano de contingência e avaliar a segurança no transporte escolar.'
        };
    }
    if (highestTier === 'ORANGE') {
        return {
            header: '⚠️ ALERTA METEOROLÓGICO — RISCO SEVERO',
            criteria: '🚧 CRITÉRIO: AVALIAÇÃO DE SEGURANÇA E CONTINGÊNCIA',
            footer: '⚠️ Recomenda-se avaliar as condições de transporte e acompanhar as orientações oficiais.'
        };
    }
    if (highestTier === 'YELLOW') {
        return {
            header: 'ℹ️ AVISO METEOROLÓGICO — RISCO POTENCIAL',
            criteria: '👁️ CRITÉRIO: ACOMPANHAMENTO E PREPARAÇÃO',
            footer: 'ℹ️ Recomenda-se acompanhar as atualizações oficiais e as condições locais.'
        };
    }
    return {
        header: 'ℹ️ AVISO METEOROLÓGICO',
        criteria: '👁️ CRITÉRIO: ACOMPANHAMENTO',
        footer: 'ℹ️ Consulte as atualizações oficiais para orientar as próximas decisões.'
    };
}

/**
 * Invite-code prompt shown to non-admin users.
 * Also serves as friendly hello for regular users — includes last-scan hint.
 *
 * @returns {string}
 */
export function buildInviteRequiredMessage() {
    return buildRegularWelcomeMessage();
}

/**
 * Builds friendly hello for regular (non-admin) users with last-scan hint.
 * Keeps "restrito ao administrador" phrase for backward compat with existing tests
 * and clear permission messaging.
 *
 * @returns {string}
 */
export function buildRegularWelcomeMessage() {
    return [
        '👋 Olá! Bem-vindo ao Monitor Meteorológico — Charqueadas / RS',
        CARD_HEADER,
        'Sou o bot de monitoramento 24/7 de riscos (INMET + Defesa Civil RS).',
        'Este bot está restrito ao administrador configurado para ajustes e varreduras ao vivo,',
        'mas você pode consultar os últimos alertas já verificados sem gerar nova varredura.',
        '',
        '🔑 Para acesso completo, peça a um administrador um código de convite',
        '   em: ⚙️ Configurações → 👥 Convidar Administrador',
        '   O código tem 8 caracteres A-Z0-9 e expira em 5 minutos (uso único).',
        '   Basta colar o código aqui como mensagem (pode estar dentro de frase).',
        '',
        CARD_DIVIDER,
        '💡 Toque em “🚨 Ver Últimos Alertas” abaixo para ver o último scan.'
    ].join('\n');
}

/**
 * Encapsulates the Weather Telegram bot UI, lifecycle, and callback routing.
 */
export class WeatherTelegramBot {

    /**
     * @param {object} options
     * @param {import('./telegram.js').TelegramBotClient} options.telegram - Telegram wrapper client.
     * @param {object} [options.monitorService] - Running monitor service instance for dynamic config updates.
     * @param {() => string} [options.getStatus] - Custom status text provider.
     * @param {Console} [options.logger=console] - Logger instance.
     */
    constructor({ telegram, monitorService = null, getStatus = null, logger = console }) {
        if (!telegram) throw new Error('A Telegram bot client is required.');

        this.telegram = telegram;
        this.monitorService = monitorService;
        this.getStatus = getStatus;
        this.logger = logger;

        this.localState = parseMonitorConfig();
        this.syncAdminsFromStore();

        this.registerHandlers();
    }

    /**
     * Syncs persisted extra administrators from SQLite into the in-memory Telegram allowlist.
     * Safe to call multiple times; deduplicates automatically.
     *
     * @returns {number} Number of persisted admins synced.
     */
    syncAdminsFromStore() {
        try {
            const persisted = getPersistedAdminChatIds();
            let added = 0;
            for (const chatId of persisted) {
                if (this.telegram.addAdminChatId(chatId)) added += 1;
            }
            return added;
        } catch {
            return 0;
        }
    }

    /**
     * Attaches or updates the reference to the active monitor service.
     * 
     * @param {object} monitorService
     */
    setMonitorService(monitorService) {
        this.monitorService = monitorService;
    }

    /**
     * Retrieves the active monitoring and alert configuration.
     * 
     * @returns {{ radiusKm: number, intervalMinutes: number, intervalMs: number, inmetMinSeverity: string, defesaCivilMinSeverity: string, categoryMinSeverities: Record<string,string> }}
     */
    getConfig() {
        if (this.monitorService?.getConfig) {
            return this.monitorService.getConfig();
        }
        return this.localState;
    }

    /**
     * Updates runtime configuration for the monitor service or local fallback state.
     * 
     * @param {object} update
     * @param {number} [update.radiusKm]
     * @param {number} [update.intervalMinutes]
     * @param {string} [update.inmetMinSeverity]
     * @param {string} [update.defesaCivilMinSeverity]
     * @param {Record<string,string>} [update.categoryMinSeverities]
     * @returns {object} Updated configuration.
     */
    updateConfig(update) {
        if (this.monitorService?.updateConfig) {
            return this.monitorService.updateConfig(update);
        }
        if (update.radiusKm) {
            this.localState.radiusKm = update.radiusKm;
            try { saveSystemSetting('radius_km', update.radiusKm); } catch {}
        }
        if (update.intervalMinutes) {
            this.localState.intervalMinutes = update.intervalMinutes;
            this.localState.intervalMs = update.intervalMinutes * 60 * 1000;
            try { saveSystemSetting('interval_minutes', update.intervalMinutes); } catch {}
        }
        if (update.inmetMinSeverity) {
            this.localState.inmetMinSeverity = normalizeSeverityTier(update.inmetMinSeverity);
            try { saveSystemSetting('inmet_min_severity', this.localState.inmetMinSeverity); } catch {}
        }
        if (update.defesaCivilMinSeverity) {
            this.localState.defesaCivilMinSeverity = normalizeSeverityTier(update.defesaCivilMinSeverity);
            try { saveSystemSetting('defesa_civil_min_severity', this.localState.defesaCivilMinSeverity); } catch {}
        }
        if (update.categoryMinSeverities && typeof update.categoryMinSeverities === 'object') {
            if (!this.localState.categoryMinSeverities) this.localState.categoryMinSeverities = {};
            for (const categoryId of Object.keys(ALERT_CATEGORIES)) {
                if (Object.prototype.hasOwnProperty.call(update.categoryMinSeverities, categoryId)) {
                    const tier = normalizeSeverityTier(update.categoryMinSeverities[categoryId]);
                    this.localState.categoryMinSeverities[categoryId] = tier;
                    try { saveSystemSetting(`alert_cat_${categoryId}`, tier); } catch {}
                }
            }
        }
        return this.getConfig();
    }

    /**
     * Checks if a Telegram chat context originates from an authorized administrator.
     * Checks both in-memory allowlist and persisted extra admins to survive restarts
     * and cross-process promotion without requiring an immediate restart.
     *
     * @param {object} ctx - grammY context.
     * @returns {boolean}
     */
    isAdmin(ctx) {
        const chatId = ctx.chat?.id;
        if (chatId === undefined || chatId === null) return false;
        if (this.telegram.isAdminChat(chatId)) return true;
        try {
            const persisted = getPersistedAdminChatIds();
            return persisted.includes(String(chatId));
        } catch {
            return false;
        }
    }

    /**
     * Sends the standardized unauthorized access response (invite-code prompt).
     * Non-admins receive this for any command/callback; it instructs them to paste
     * an 8-char A-Z0-9 invite code generated by an existing admin.
     *
     * @param {object} ctx - grammY context.
     * @returns {Promise<object>}
     */
    replyUnauthorized(ctx) {
        return this.replyInviteRequired(ctx);
    }

    /**
     * Sends the invite-code instruction to a non-admin chat (friendly hello + last-scan keyboard).
     *
     * @param {object} ctx - grammY context.
     * @returns {Promise<object>}
     */
    replyInviteRequired(ctx) {
        return ctx.reply(buildRegularWelcomeMessage(), {
            reply_markup: WeatherTelegramBot.buildRegularKeyboard()
        });
    }

    /**
     * Attempts to promote a non-admin chat via an invite code pasted as plain text.
     * Supports surrounding text via extractInviteCodeFromText, single-use 5-min expiry.
     *
     * @param {object} ctx - grammY context.
     * @param {string} rawCode - Raw message text.
     * @returns {Promise<object|null>} Reply result or null if no code found in text.
     */
    async tryConsumeInviteCode(ctx, rawCode) {
        const extracted = extractInviteCodeFromText(rawCode) || normalizeInviteCode(rawCode);
        if (!INVITE_CODE_REGEX.test(extracted)) return null;
        const normalized = extracted;

        const chatId = String(ctx.chat?.id);
        const result = consumeInviteCode(normalized, chatId);
        if (result.success) {
            this.telegram.addAdminChatId(chatId);
            // Ensure any other persisted state is synced (defensive)
            this.syncAdminsFromStore();
            return ctx.reply([
                '✅ CÓDIGO ACEITO — ACESSO LIBERADO',
                CARD_HEADER,
                `Bem-vindo! Seu chat \`${chatId}\` agora é administrador.`,
                '',
                'Você já pode usar:',
                '• /start — painel principal',
                '• /status — diagnóstico',
                '• /config — ajustes de monitoramento',
                '• /alertas — avisos ativos',
                '',
                CARD_DIVIDER,
                '🔒 O código foi invalidado (uso único).'
            ].join('\n'), { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
        }
        if (result.reason === 'already_admin') {
            this.telegram.addAdminChatId(chatId);
            return ctx.reply([
                'ℹ️ Você já é administrador.',
                CARD_HEADER,
                'Use /start para abrir o painel principal.'
            ].join('\n'), { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
        }
        if (result.reason === 'expired') {
            return ctx.reply([
                '⏰ CÓDIGO EXPIRADO',
                CARD_HEADER,
                `O código \`${normalized}\` expirou (validade 5 minutos).`,
                '',
                'Peça a um administrador que gere um novo código em:',
                '⚙️ Configurações → 👥 Convidar Administrador'
            ].join('\n'));
        }
        if (result.reason === 'revoked') {
            return ctx.reply([
                '🚫 CÓDIGO REVOGADO',
                CARD_HEADER,
                `O código \`${normalized}\` foi revogado pelo administrador.`,
                '',
                'Peça um novo código em:',
                '⚙️ Configurações → 👥 Convidar Administrador'
            ].join('\n'));
        }
        return ctx.reply([
            '❌ CÓDIGO INVÁLIDO',
            CARD_HEADER,
            `O código \`${normalized}\` não é válido, já foi usado ou expirou.`,
            '',
            'Peça a um administrador que gere um novo código em:',
            '⚙️ Configurações → 👥 Convidar Administrador'
        ].join('\n'));
    }

    /**
     * Registers bot autocomplete commands with the Telegram API.
     * 
     * @returns {Promise<boolean>}
     */
    async initCommands() {
        try {
            if (this.telegram?.bot?.api?.setMyCommands) {
                await this.telegram.bot.api.setMyCommands(BOT_COMMANDS);
                return true;
            }
        } catch (err) {
            this.logger.warn?.('Could not register Telegram bot commands with API:', err.message);
        }
        return false;
    }

    // =========================================================================
    // KEYBOARD BUILDERS
    // =========================================================================

    /**
     * Builds the primary inline keyboard for the bot main dashboard (admin).
     *
     * @returns {InlineKeyboard}
     */
    static buildMainMenuKeyboard() {
        return new InlineKeyboard()
            .text('🔍 Status & Varredura', 'action:status')
            .text('🚨 Alertas Ativos', 'action:active_alerts')
            .row()
            .text('⚙️ Configurações', 'menu:settings')
            .text('❓ Ajuda & Comandos', 'action:help');
    }

    /**
     * Builds the friendly keyboard for regular (non-admin) users.
     * Last scan is read-only, no live API scan triggered.
     *
     * @returns {InlineKeyboard}
     */
    static buildRegularKeyboard() {
        return new InlineKeyboard()
            .text('🚨 Ver Últimos Alertas', 'action:last_scan')
            .row()
            .text('ℹ️ Sobre o Bot', 'action:regular_about')
            .row()
            .text('🔑 Já tenho código', 'action:regular_help');
    }

    /**
     * Builds the settings overview inline keyboard, showing the current color
     * circle badge of each provider's minimum alert level and a summary of
     * per-category thresholds.
     *
     * @param {object} [config] - Active monitoring configuration.
     * @param {string} [config.inmetMinSeverity] - Current INMET minimum severity tier.
     * @param {string} [config.defesaCivilMinSeverity] - Current Defesa Civil RS minimum severity tier.
     * @param {Record<string,string>} [config.categoryMinSeverities] - Per-category tier map.
     * @returns {InlineKeyboard}
     */
    static buildSettingsKeyboard(config = {}) {
        const total = Object.keys(ALERT_CATEGORIES).length;
        const tierMap = config.categoryMinSeverities || {};
        const enabledCount = Object.values(tierMap).filter(tier => normalizeSeverityTier(tier) !== 'OFF').length;
        // If no map provided (should not happen), assume all active
        const displayCount = Object.keys(tierMap).length === 0 ? total : enabledCount;
        return new InlineKeyboard()
            .text('⏱️ Alterar Intervalo', 'menu:interval')
            .text('📍 Alterar Raio Regional', 'menu:radius')
            .row()
            .text(`🚨 Categorias de Alerta: ${displayCount}/${total}`, 'menu:categories')
            .row()
            .text(`🏛️ Limiar INMET: ${getTierShortBadge(config.inmetMinSeverity)}`, 'menu:inmet_level')
            .row()
            .text(`🛡️ Limiar Defesa Civil: ${getTierShortBadge(config.defesaCivilMinSeverity)}`, 'menu:defesa_civil_level')
            .row()
            .text('👥 Convidar Administrador', 'menu:admins')
            .row()
            .text('⬅️ Voltar ao Menu Principal', 'menu:main');
    }

    /**
     * Builds the admin invite management keyboard.
     * Shows generate / revoke actions and current invite status.
     *
     * @param {{ hasActiveCode: boolean }} [options]
     * @returns {InlineKeyboard}
     */
    static buildAdminsKeyboard({ hasActiveCode = false } = {}) {
        const kb = new InlineKeyboard();
        kb.text('🎟️ Gerar Código de Convite (8 caracteres)', 'action:generate_invite').row();
        if (hasActiveCode) {
            kb.text('🔁 Regenerar Código', 'action:generate_invite').row();
            kb.text('🚫 Revogar Código Ativo', 'action:revoke_invite').row();
        }
        kb.text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }

    /**
     * Builds the alert-category selection keyboard with per-category intensity badges.
     * Each row navigates to a dedicated intensity selector for that category.
     *
     * @param {Record<string,string>} [categoryMinSeverities] - Per-category tier map.
     * @returns {InlineKeyboard}
     */
    static buildCategoriesKeyboard(categoryMinSeverities = {}) {
        const kb = new InlineKeyboard();
        for (const [categoryId, definition] of Object.entries(ALERT_CATEGORIES)) {
            const tier = categoryMinSeverities[categoryId] ?? 'YELLOW';
            const badge = getTierShortBadge(tier);
            kb.text(`${definition.emoji} ${definition.label}: ${badge}`, `menu:category:${categoryId}`).row();
        }
        kb.text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }

    /**
     * Builds the intensity level selection keyboard for a single alert category.
     *
     * @param {string} categoryId - Category identifier (see ALERT_CATEGORIES).
     * @param {string} [currentLevel='YELLOW'] - Current tier for this category.
     * @returns {InlineKeyboard}
     */
    static buildCategoryLevelKeyboard(categoryId, currentLevel = 'YELLOW') {
        const kb = new InlineKeyboard();
        const norm = String(currentLevel || '').toUpperCase();
        CATEGORY_SEVERITY_OPTIONS.forEach(opt => {
            const isCurrent = norm === opt.id;
            const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
            kb.text(label, `set_cat:${categoryId}:${opt.id}`).row();
        });
        kb.text('⬅️ Voltar às Categorias', 'menu:categories');
        return kb;
    }

    /**
     * Renders the alert-categories management text with per-category tier badges.
     *
     * @param {Record<string,string>} [categoryMinSeverities] - Per-category tier map.
     * @returns {string}
     */
    renderCategoriesMenu(categoryMinSeverities = {}) {
        const lines = [
            '🚨 CATEGORIAS DE ALERTA',
            CARD_HEADER,
            'Ajuste o limiar mínimo de severidade para cada grupo de eventos:',
            ''
        ];
        for (const [categoryId, definition] of Object.entries(ALERT_CATEGORIES)) {
            const tier = categoryMinSeverities[categoryId] ?? 'YELLOW';
            lines.push(`${definition.emoji} ${definition.label}: ${getTierBadge(tier)}`);
        }
        lines.push('', CARD_DIVIDER);
        lines.push('💡 Toque em uma categoria para escolher o nível mínimo (Vermelho/Laranja/Amarelo/Desativado), igual aos limiares por instituto.');
        return lines.join('\n');
    }

    /**
     * Renders the intensity selector text for a single alert category.
     *
     * @param {string} categoryId - Category identifier.
     * @param {string} [currentTier='YELLOW'] - Current tier for this category.
     * @returns {string}
     */
    renderCategoryLevelMenu(categoryId, currentTier = 'YELLOW') {
        const definition = ALERT_CATEGORIES[categoryId];
        if (!definition) return 'Categoria desconhecida.';
        return [
            `🚨 LIMIAR — ${definition.emoji} ${definition.label.toUpperCase()}:`,
            CARD_HEADER,
            `Limiar ativo: ${getTierBadge(currentTier)}`,
            '',
            'Selecione o nível mínimo para acionamento de alertas desta categoria:'
        ].join('\n');
    }

    /**
     * Renders the admin invite management menu with current invite status and allowlist.
     * Shows 5-minute expiry countdown.
     *
     * @returns {string}
     */
    renderAdminsMenu() {
        const persisted = (() => { try { return getPersistedAdminChatIds(); } catch (err) { console.error('[telegram_bot] renderAdminsMenu persisted error:', err.message); return []; } })();
        const active = (() => { try { return getActiveInviteCode(); } catch (err) { console.error('[telegram_bot] renderAdminsMenu active error:', err.message); return null; } })();
        const adminIds = this.telegram.getAdminChatIds();
        const lines = [
            '👥 GERENCIAR ADMINISTRADORES',
            CARD_HEADER,
            `Administradores ativos: ${adminIds.length}`,
            adminIds.length ? `IDs: ${adminIds.join(', ')}` : 'Nenhum administrador além do configurado via ambiente',
            persisted.length ? `Convidados via código: ${persisted.join(', ')}` : 'Nenhum convidado ainda',
            '',
            CARD_DIVIDER
        ];
        if (active) {
            lines.push(`🎟️ Código ativo: \`${active.code}\``);
            lines.push(`Criado em: ${active.createdAt || '—'} por ${active.createdBy || '—'}`);
            if (active.expiresAt) {
                const msLeft = new Date(active.expiresAt).getTime() - Date.now();
                const mins = Math.max(0, Math.floor(msLeft / 60000));
                const secs = Math.max(0, Math.floor((msLeft % 60000) / 1000));
                lines.push(`Expira em: ${mins}m ${secs}s (5 minutos)`);
            } else if (active.createdAt) {
                const age = Date.now() - new Date(active.createdAt).getTime();
                const left = Math.max(0, 5 * 60 * 1000 - age);
                const mins = Math.floor(left / 60000);
                const secs = Math.floor((left % 60000) / 1000);
                lines.push(`Expira em: ${mins}m ${secs}s (5 minutos)`);
            }
            lines.push('Envie este código ao novo administrador. É de uso único e expira em 5 minutos.');
        } else {
            lines.push('Nenhum código de convite ativo no momento.');
            lines.push('Gere um novo código para convidar um administrador (expira em 5 minutos).');
        }
        lines.push('', '💡 O convidado deve enviar o código aqui como mensagem de texto (8 caracteres A-Z0-9). Pode estar dentro de frase — o bot extrai o código.');
        return lines.join('\n');
    }

    /**
     * Returns the bot username for invite links, if known.
     *
     * @returns {string|null}
     */
    getBotUsername() {
        try {
            const fromInfo = this.telegram?.bot?.botInfo?.username;
            if (fromInfo) return String(fromInfo).replace(/^@/, '');
            const envName = process.env.TELEGRAM_BOT_USERNAME;
            if (envName) return String(envName).replace(/^@/, '');
        } catch {}
        return null;
    }

    /**
     * Builds a shareable invite link that auto-starts the bot with the code.
     * User clicking the link triggers /start <code> and then sees Accept/Refuse.
     *
     * @param {string} code - Invite code.
     * @returns {string|null} HTTPS link or null if username unknown.
     */
    buildInviteLink(code) {
        const username = this.getBotUsername();
        if (!username) return null;
        const normalized = normalizeInviteCode(code);
        return `https://t.me/${username}?start=${normalized}`;
    }

    /**
     * Renders the newly generated invite code for display to the admin.
     * Shows 5-minute expiry and shareable link that auto-sends the code.
     *
     * @param {string} code - Generated invite code.
     * @returns {string}
     */
    renderInviteGenerated(code) {
        const active = (() => { try { return getActiveInviteCode(); } catch { return null; } })();
        const expiryLine = active?.expiresAt
            ? `Expira em: ${new Date(active.expiresAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (5 minutos)`
            : 'Expira em 5 minutos';
        const link = this.buildInviteLink(code);
        const lines = [
            '🎟️ CÓDIGO DE CONVITE GERADO',
            CARD_HEADER,
            `Código: \`${code}\``,
            expiryLine,
            ''
        ];
        if (link) {
            lines.push(`🔗 Link de convite (clique para aceitar):`);
            lines.push(link);
            lines.push('');
            lines.push('Ao clicar, o usuário inicia o bot e vê botões [Aceitar] [Recusar].');
        } else {
            lines.push('Compartilhe este código com o novo administrador.');
            lines.push('Ele deve iniciar conversa com o bot e enviar o código como mensagem.');
            lines.push('(Pode colar com texto ao redor — o bot extrai o código)');
        }
        lines.push('', CARD_DIVIDER, '⚠️ Uso único — será invalidado após o primeiro resgate ou após expirar.', '🔁 Gere um novo código se precisar convidar outra pessoa.');
        return lines.join('\n');
    }

    /**
     * Renders the accept/refuse prompt for a user who arrived via invite link (/start <code>).
     *
     * @param {string} code - Invite code from start payload.
     * @returns {string}
     */
    renderInviteAcceptPrompt(code) {
        const active = (() => { try { return getActiveInviteCode(); } catch { return null; } })();
        const isActive = active && active.code === normalizeInviteCode(code);
        const expiryInfo = isActive && active.expiresAt
            ? `Expira em: ${new Date(active.expiresAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
            : 'Expira em 5 minutos (uso único)';
        return [
            '🎟️ CONVITE PARA ADMINISTRADOR',
            CARD_HEADER,
            `Você recebeu um convite para ser administrador do Monitor Charqueadas.`,
            `Código: \`${normalizeInviteCode(code)}\``,
            expiryInfo,
            '',
            'Deseja aceitar o convite?',
            CARD_DIVIDER,
            'Toque em Aceitar para confirmar ou Recusar para ignorar.'
        ].join('\n');
    }

    /**
     * Renders the bootstrap prompt for the very first user when no admin exists.
     * Same accept/refuse flow as valid code, but without code.
     *
     * @returns {string}
     */
    renderBootstrapPrompt() {
        return [
            '🎉 BEM-VINDO — CONFIGURAÇÃO INICIAL',
            CARD_HEADER,
            'Nenhum administrador configurado ainda.',
            'Você é o primeiro a iniciar conversa com o bot.',
            '',
            'Deseja se tornar o administrador principal?',
            'Como admin você poderá:',
            '• Ajustar raio, intervalo e limiares em ⚙️ Configurações',
            '• Gerar códigos de convite para outros admins',
            '• Receber alertas meteorológicos em tempo real',
            '',
            CARD_DIVIDER,
            'Toque em Aceitar para confirmar ou Recusar para continuar como visitante (apenas leitura do último scan).'
        ].join('\n');
    }

    /**
     * Renders the friendly about text for regular users.
     *
     * @returns {string}
     */
    renderRegularAbout() {
        return [
            'ℹ️ SOBRE O BOT — CHARQUEADAS / RS',
            CARD_HEADER,
            'Monitoramento 24/7 de riscos meteorológicos (INMET + Defesa Civil RS).',
            '• Fontes: avisos oficiais INMET e telemetria Defesa Civil RS (rios Jacuí/Guaíba, chuva, vento).',
            '• Janela: próximas 24 horas, raio configurado pelo administrador.',
            '• Atualização automática a cada ciclo (15 min padrão).',
            '',
            'Como regular, você vê o último scan já realizado (sem nova varredura).',
            'Administradores veem varredura ao vivo via “🚨 Alertas Ativos”.',
            '',
            CARD_DIVIDER,
            '🔑 Para virar administrador, peça um código de convite (8 A-Z0-9, 5 min) a um admin e cole aqui.'
        ].join('\n');
    }

    /**
     * Renders the last scan snapshot (no live API call) for regular users.
     * Uses the cached snapshot from monitor_service (last_scan_snapshot system_settings).
     *
     * @returns {string}
     */
    renderLastScanReport() {
        const snapshot = (() => { try { return getLastScanSnapshot(); } catch (err) { console.error('[telegram_bot] getLastScanSnapshot error:', err.message); return null; } })();
        if (!snapshot) {
            return [
                '🟡 NENHUM SCAN RECENTE',
                CARD_HEADER,
                'Ainda não há varredura registrada desde o último reinício.',
                'Aguarde o próximo ciclo automático (15 min) ou peça a um administrador para verificar.',
                '',
                CARD_DIVIDER,
                `🕒 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
            ].join('\n');
        }
        const events = Array.isArray(snapshot.events) ? snapshot.events : [];
        const timestamp = snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
        if (events.length === 0) {
            const lines = [
                '🟢 ÚLTIMO SCAN — NENHUM ALERTA ATIVO',
                CARD_HEADER,
                `Varredura em: ${timestamp}`,
                `Raio: ${snapshot.radiusKm ?? '—'} km | ${snapshot.citiesCount ?? '—'} municípios | ${snapshot.durationMs ?? '—'} ms`,
                `Status dados: ${snapshot.dataQuality?.complete ? '✅ completo' : '⚠️ parcial'}`,
                ''
            ];
            if (snapshot.dataQuality?.errors?.length) {
                lines.push(`⚠️ Nota: ${snapshot.dataQuality.errors.join('; ')}`);
                lines.push('');
            }
            lines.push(CARD_DIVIDER);
            lines.push('💡 Monitoramento continua 24/7; novos alertas surgirão no próximo ciclo.');
            lines.push('⚠️ Fontes: INMET + Defesa Civil RS (último scan, sem nova varredura).');
            return lines.join('\n');
        }
        const aggregated = aggregateRiskEvents(events);
        const uniqueCities = [...new Set(events.flatMap(e => e.affectedCities || []))];
        const presentation = getAlertPresentation(aggregated);
        const lines = [
            `📋 ÚLTIMO SCAN — ${presentation.header.replace('🚨 ', '').replace('⚠️ ', '').replace('ℹ️ ', '')}`,
            `(${presentation.criteria})`,
            CARD_HEADER,
            `🕒 Varredura em: ${timestamp}`,
            `📊 ${aggregated.length} tipos agrupados — ${events.length} ocorrências em ${uniqueCities.length} de ${snapshot.citiesCount ?? '—'} municípios`,
            `📏 Raio: ${snapshot.radiusKm ?? '—'} km | Status: ${snapshot.dataQuality?.complete ? '✅ completo' : '⚠️ parcial'}`,
            ''
        ];
        aggregated.forEach((event, idx) => {
            const badge = renderSeverityBadge(event.severity);
            const cityCount = event.affectedCities.length;
            const cityLabel = cityCount === 1 ? event.affectedCities[0] : `${cityCount} municípios: ${event.affectedCities.join(', ')}`;
            const occNote = event.aggregatedCount > 1 ? ` (${event.aggregatedCount} ocorrências)` : '';
            lines.push(`${idx + 1}. ${event.emoji || '⚠️'} ${event.type}${occNote}`);
            lines.push(`   Severidade: ${badge}`);
            lines.push(`   Origem: ${event.source || '—'}`);
            lines.push(`   Municípios: ${cityLabel}`);
            lines.push(`   Janela: ${event.timeframe || '—'}`);
            lines.push(`   💡 Motivo: ${event.triggerReason || '—'}`);
            if (event.details && event.details !== event.triggerReason) lines.push(`   📝 Detalhes: ${event.details}`);
            if (idx < aggregated.length - 1) lines.push('', CARD_DIVIDER, '');
        });
        lines.push('', CARD_HEADER);
        lines.push('ℹ️ Este é o último scan registrado (sem nova varredura ao vivo).');
        if (snapshot.dataQuality?.errors?.length) {
            lines.push(`⚠️ Nota dados parciais: ${snapshot.dataQuality.errors.join('; ')}`);
        }
        lines.push(`⚠️ Fontes: INMET + Defesa Civil RS | Snapshot: ${timestamp}`);
        return lines.join('\n');
    }

    /**
     * Builds the interval selection inline keyboard with active indicator.
     *
     * @param {number} [currentMinutes=15]
     * @returns {InlineKeyboard}
     */
    static buildIntervalKeyboard(currentMinutes = 15) {
        const intervals = [5, 15, 30, 60];
        const kb = new InlineKeyboard();

        intervals.forEach((mins, idx) => {
            const isCurrent = Math.round(currentMinutes) === mins;
            const label = `${isCurrent ? '✅ ' : '⏱️ '}${mins} min`;
            kb.text(label, `set_interval:${mins}`);
            if (idx % 2 === 1) kb.row();
        });

        kb.row().text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }

    /**
     * Builds the radius selection inline keyboard with active indicator.
     *
     * @param {number} [currentRadius=50]
     * @returns {InlineKeyboard}
     */
    static buildRadiusKeyboard(currentRadius = 50) {
        const radii = [
            { km: 25, name: '25 km' },
            { km: 50, name: '50 km' },
            { km: 75, name: '75 km' },
            { km: 100, name: '100 km' }
        ];
        const kb = new InlineKeyboard();

        radii.forEach((r, idx) => {
            const isCurrent = Math.round(currentRadius) === r.km;
            const label = `${isCurrent ? '✅ ' : '📍 '}${r.name}`;
            kb.text(label, `set_radius:${r.km}`);
            if (idx % 2 === 1) kb.row();
        });

        kb.row().text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }

    /**
     * Builds the INMET severity level selection keyboard.
     *
     * @param {string} [currentLevel='RED']
     * @returns {InlineKeyboard}
     */
    static buildInmetLevelKeyboard(currentLevel = 'RED') {
        const kb = new InlineKeyboard();
        const norm = String(currentLevel || '').toUpperCase();
        INMET_SEVERITY_OPTIONS.forEach(opt => {
            const isCurrent = norm === opt.id;
            const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
            kb.text(label, `set_inmet:${opt.id}`).row();
        });
        kb.text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }

    /**
     * Builds the Defesa Civil RS severity level selection keyboard.
     *
     * @param {string} [currentLevel='ORANGE']
     * @returns {InlineKeyboard}
     */
    static buildDefesaCivilLevelKeyboard(currentLevel = 'ORANGE') {
        const kb = new InlineKeyboard();
        const norm = String(currentLevel || '').toUpperCase();
        DEFESA_CIVIL_SEVERITY_OPTIONS.forEach(opt => {
            const isCurrent = norm === opt.id;
            const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
            kb.text(label, `set_dc:${opt.id}`).row();
        });
        kb.text('⬅️ Voltar às Configurações', 'menu:settings');
        return kb;
    }


    /**
     * Builds the action tray keyboard attached to broadcast alerts.
     *
     * @returns {InlineKeyboard}
     */
    static buildAlertActionKeyboard() {
        return new InlineKeyboard()
            .text('🚨 Alertas Ativos', 'action:active_alerts')
            .row()
            .text('🏠 Abrir Painel Principal', 'menu:main');
    }

    // =========================================================================
    // UI TEMPLATE RENDERERS
    // =========================================================================

    /**
     * Renders the main dashboard text.
     * 
     * @returns {string}
     */
    renderMainMenu() {
        const config = this.getConfig();
        return [
            '🌤️ PAINEL METEOROLÓGICO — CHARQUEADAS / RS',
            CARD_HEADER,
            'Monitoramento 24/7 de Riscos Meteorológicos na Região',
            '',
            `📍 Município Central: Charqueadas - RS (IBGE 4305355)`,
            `📏 Raio de Cobertura: ${config.radiusKm} km`,
            `⏱️ Intervalo de Varredura: A cada ${config.intervalMinutes} min`,
            `🏛️ Limiar INMET: ${getTierBadge(config.inmetMinSeverity)}`,
            `🛡️ Limiar Defesa Civil: ${getTierBadge(config.defesaCivilMinSeverity)}`,
            CARD_DIVIDER,
            'Selecione uma ação rápida nos botões abaixo:'
        ].join('\n');
    }

    /**
     * Renders the settings overview text.
     * 
     * @returns {string}
     */
    renderSettingsMenu() {
        const config = this.getConfig();
        const tierMap = config.categoryMinSeverities || {};
        const activeCategoryCount = Object.values(tierMap).filter(tier => normalizeSeverityTier(tier) !== 'OFF').length;
        const displayCount = Object.keys(tierMap).length === 0 ? Object.keys(ALERT_CATEGORIES).length : activeCategoryCount;
        return [
            '⚙️ CONFIGURAÇÕES DO MONITOR',
            CARD_HEADER,
            `• Raio Regional:          ${config.radiusKm} km`,
            `• Intervalo de Varredura:  A cada ${config.intervalMinutes} minutos`,
            `• Limiar Alerta INMET:     ${getTierBadge(config.inmetMinSeverity)}`,
            `• Limiar Defesa Civil RS:  ${getTierBadge(config.defesaCivilMinSeverity)}`,
            `• Categorias Ativas:       ${displayCount} de ${Object.keys(ALERT_CATEGORIES).length}`,
            CARD_DIVIDER,
            'Escolha o parâmetro que deseja ajustar de forma independente:'
        ].join('\n');
    }

    /**
     * Renders the full diagnostics and status report.
     * 
     * @returns {string}
     */
    renderStatusReport() {
        if (typeof this.getStatus === 'function') {
            return this.getStatus();
        }

        const config = this.getConfig();
        let stats = null;
        try {
            stats = getFetchStats();
        } catch {}

        return [
            '📊 DIAGNÓSTICO DO SERVIÇO DE MONITORAMENTO',
            CARD_HEADER,
            '• Status: ✅ ATIVO E MONITORANDO EM TEMPO REAL',
            `• Município Central: Charqueadas - RS (IBGE 4305355)`,
            `• Raio Regional: ${config.radiusKm} km`,
            `• Intervalo de Varredura: A cada ${config.intervalMinutes} min`,
            `• Limiar INMET: ${getTierBadge(config.inmetMinSeverity)}`,
            `• Limiar Defesa Civil RS: ${getTierBadge(config.defesaCivilMinSeverity)}`,
            '',
            '📈 Métricas do Banco de Dados (SQLite):',
            stats ? `  - Requisições Registradas: ${stats.totalFetches} (${stats.successfulFetches} OK)` : '  - Banco SQLite conectado',
            stats ? `  - Tempo Médio de Resposta: ${Math.round(stats.avgDurationMs || 0)} ms` : '',
            stats ? `  - Alertas Históricos Gravados: ${stats.totalAlertsRecorded}` : '',
            CARD_DIVIDER,
            `🕒 Consulta realizada em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        ].filter(Boolean).join('\n');
    }

    /**
     * Runs an on-demand multi-source risk scan (INMET avisos + forecasts and
     * Defesa Civil RS telemetry) and renders a combined alert report.
     * Uses the shared monitoring coordinator so thresholds, radius, and
     * quality handling stay identical to the background service.
     *
     * @returns {Promise<string>}
     */
    async renderActiveAlertsReport() {
        try {
            const config = this.getConfig();
            const result = await performRegionalRiskMonitoring({
                radiusKm: config.radiusKm,
                inmetMinSeverity: config.inmetMinSeverity,
                defesaCivilMinSeverity: config.defesaCivilMinSeverity,
                categoryMinSeverities: config.categoryMinSeverities || null,
                alertCallback: null
            });

            if (result.events.length === 0) {
                const lines = [
                    '🟢 NENHUM ALERTA ATIVO NO MOMENTO',
                    CARD_HEADER,
                    `Raio monitorado: ${result.citiesCount} municípios (${config.radiusKm} km)`,
                    `Limiares ativos: INMET ${getTierBadge(config.inmetMinSeverity)} | Defesa Civil ${getTierBadge(config.defesaCivilMinSeverity)}`,
                    `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                    ''
                ];
                if (!result.dataQuality.complete) {
                    lines.push(`⚠️ Dados parcialmente indisponíveis: ${result.dataQuality.errors.join('; ')}`);
                    lines.push('');
                }
                lines.push(CARD_DIVIDER);
                lines.push('💡 O monitoramento continua 24/7 a cada ciclo agendado (apenas alertas dentro do limiar configurado são exibidos).');
                lines.push('⚠️ Fontes: avisos oficiais do INMET e telemetria da Defesa Civil RS.');
                return lines.join('\n');
            }

            const aggregated = aggregateRiskEvents(result.events);
            const uniqueCities = [...new Set(result.events.flatMap(event => event.affectedCities || []))];

            const presentation = getAlertPresentation(aggregated);
            const lines = [
                presentation.header,
                presentation.criteria,
                CARD_HEADER,
                `🕒 Detectado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                `📊 ${aggregated.length} tipos de alerta agrupados — ${result.events.length} ocorrências em ${uniqueCities.length} de ${result.citiesCount} municípios monitorados`,
                `🎯 Limiares aplicados: INMET ${getTierBadge(config.inmetMinSeverity)} | Defesa Civil ${getTierBadge(config.defesaCivilMinSeverity)}`,
                `📏 Raio: ${config.radiusKm} km`,
                ''
            ];

            aggregated.forEach((event, index) => {
                const badge = renderSeverityBadge(event.severity);
                const cityCount = event.affectedCities.length;
                const cityLabel = cityCount === 1 ? event.affectedCities[0] : `${cityCount} municípios: ${event.affectedCities.join(', ')}`;
                const occurrenceNote = event.aggregatedCount > 1 ? ` (${event.aggregatedCount} ocorrências agrupadas)` : '';
                lines.push(`${index + 1}. ${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico severo'}${occurrenceNote}`);
                lines.push(`   Severidade: ${badge}`);
                lines.push(`   Origem: ${event.source || 'Não informada'}`);
                lines.push(`   Municípios: ${cityLabel}`);
                lines.push(`   Janela: ${event.timeframe || 'Não informada'}`);
                lines.push(`   💡 Motivo: ${event.triggerReason || 'Não informado'}`);
                if (event.details && event.details !== event.triggerReason) {
                    lines.push(`   📝 Detalhes: ${event.details}`);
                }
                if (index < aggregated.length - 1) lines.push('', CARD_DIVIDER, '');
            });

            lines.push('', CARD_HEADER);
            lines.push(presentation.footer);
            if (!result.dataQuality.complete) {
                lines.push('', `${CARD_DIVIDER}`);
                lines.push(`⚠️ Nota: dados parcialmente indisponíveis — ${result.dataQuality.errors.join('; ')}`);
            }
            lines.push(`⚠️ Fontes: avisos oficiais do INMET e telemetria da Defesa Civil RS (filtrados pelos limiares configurados).`);
            return lines.join('\n');
        } catch (err) {
            return `❌ Erro ao consultar alertas ativos: ${err.message}`;
        }
    }

    /**
     * @deprecated Use renderActiveAlertsReport() — kept for backwards compatibility.
     * @param {number} [radiusKm]
     * @returns {Promise<string>}
     */
    async renderInmetWarningsReport(radiusKm) {
        return this.renderActiveAlertsReport();
    }

    /**
     * Formats detected high-risk events as high-contrast plain text for Telegram broadcasts.
     *
     * @param {Array<object>} events - High-risk events from the risk analyzer.
     * @param {Date} [sentAt=new Date()] - Timestamp shown in the alert header.
     * @returns {string} Formatted alert message.
     */
    static formatHighRiskAlert(events, sentAt = new Date()) {
        const aggregated = aggregateRiskEvents(events);
        const presentation = getAlertPresentation(aggregated);
        const lines = [
            presentation.header,
            presentation.criteria,
            CARD_HEADER,
            `🕒 Detectado em: ${sentAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
            aggregated.length < events.length
                ? `📊 ${aggregated.length} tipos de alerta agrupados (${events.length} ocorrências)`
                : `📊 Eventos Detectados: ${aggregated.length}`,
            ''
        ];

        aggregated.forEach((event, index) => {
            const badge = renderSeverityBadge(getEventAlertTier(event));
            lines.push(`${index + 1}. ${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico severo'}`);
            lines.push(`   Severidade: ${badge}`);
            lines.push(`   Origem: ${event.source || 'Não informada'}`);
            lines.push(`   Municípios Impactados: ${(event.affectedCities || []).join(', ') || 'Não informados'}`);
            lines.push(`   Janela: ${event.timeframe || 'Não informada'}`);
            lines.push(`   💡 Motivo do Disparo: ${event.triggerReason || 'Não informado'}`);
            if (String(event.colorTier || '').toUpperCase() === 'UNKNOWN') {
                lines.push('   ⚠️ NÃO CLASSIFICADO — revisar manualmente (fonte registrada no banco para análise).');
            }

            if (event.details && event.details !== event.triggerReason) {
                lines.push(`   📝 Detalhes: ${event.details}`);
            }
            if (index < aggregated.length - 1) lines.push('', CARD_DIVIDER, '');
        });

        lines.push('', CARD_HEADER);
        lines.push(presentation.footer);

        return lines.join('\n');
    }

    /**
     * Starts the bot polling loop and resolves when stopped.
     *
     * @param {object} [options] - Polling options.
     * @returns {Promise<void>}
     */
    start(options = {}) {
        return this.telegram.start(options);
    }

    /**
     * Stops bot polling.
     *
     * @param {string} [reason] - Shutdown reason.
     */
    stop(reason) {
        this.telegram.stop(reason);
    }

    /**
     * Sends a formatted high-risk alert to all configured administrators.
     * 
     * @param {Array<object>} events - Detected high-risk events.
     * @param {Date} [sentAt] - Timestamp.
     * @returns {Promise<object>} Telegram delivery result summary.
     */
    async sendHighRiskAlerts(events, sentAt = new Date()) {
        const delivery = await this.telegram.sendToAdmins(
            WeatherTelegramBot.formatHighRiskAlert(events, sentAt),
            { reply_markup: WeatherTelegramBot.buildAlertActionKeyboard() }
        );

        if (delivery?.failed?.length > 0) {
            this.logger.error?.(`Telegram alert delivery failed for ${delivery.failed.length} administrator chat(s).`);
        }
        return delivery;
    }

    /**
     * Creates a monitor alert callback that logs and broadcasts alerts to all configured administrators.
     * 
     * @returns {(events: Array<object>) => Promise<object>}
     */
    createAlertCallback() {
        return async events => {
            onHighRiskEventDetected(events);
            return this.sendHighRiskAlerts(events);
        };
    }

    // =========================================================================
    // ROUTING & HANDLER REGISTRATION
    // =========================================================================

    /**
     * Registers all command handlers and callback query routes on the Telegram client.
     */
    registerHandlers() {
        // Command: /start & /menu -> Show Main Dashboard with Interactive Buttons
        // Supports invite link /start <CODE> → shows Accept/Refuse for non-admin
        // Bootstrap: if no admin exists yet, first /start offers to become admin (same accept/refuse flow)
        const handleStart = async ctx => {
            const payloadRaw = ctx.match !== undefined
                ? String(ctx.match)
                : String(ctx.message?.text || '').split(/\s+/).slice(1).join(' ');
            const payloadCode = payloadRaw ? (extractInviteCodeFromText(payloadRaw) || normalizeInviteCode(payloadRaw)) : null;
            const isInvitePayload = payloadCode && INVITE_CODE_REGEX.test(payloadCode);
            if (!this.isAdmin(ctx)) {
                const totalAdmins = this.telegram.getAdminChatIds().length;
                if (totalAdmins === 0) {
                    return ctx.reply(this.renderBootstrapPrompt(), {
                        reply_markup: new InlineKeyboard()
                            .text('✅ Aceitar', 'action:bootstrap_accept')
                            .text('❌ Recusar', 'action:bootstrap_reject')
                    });
                }
                if (isInvitePayload) {
                    const normalized = normalizeInviteCode(payloadCode);
                    return ctx.reply(this.renderInviteAcceptPrompt(normalized), {
                        reply_markup: new InlineKeyboard()
                            .text('✅ Aceitar', `action:invite_accept:${normalized}`)
                            .text('❌ Recusar', `action:invite_reject:${normalized}`)
                    });
                }
                return this.replyUnauthorized(ctx);
            }
            const text = this.renderMainMenu();
            return ctx.reply(text, { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
        };

        this.telegram.onCommand('start', handleStart);
        this.telegram.onCommand('menu', handleStart);

        // Command: /help -> Help and Command List (admin only; non-admins get invite prompt)
        this.telegram.onCommand('help', ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const text = [
                '📖 GUIA OPERACIONAL & COMANDOS DO BOT',
                CARD_HEADER,
                'Comandos rápidos disponíveis no chat:',
                '',
                '• /start ou /menu — Abre o painel interativo com botões de navegação',
                '• /status — Exibe o status da varredura e métricas do banco SQLite',
                '• /config — Ajusta raio, intervalo, limiares e categorias de alerta',
                '• /alertas — Consulta avisos e alertas ativos (INMET + Defesa Civil RS)',
                '',
                CARD_DIVIDER,
                '💡 Todas as opções acima também estão disponíveis nos botões do painel.'
            ].join('\n');

            return ctx.reply(text, {
                reply_markup: new InlineKeyboard().text('🌤️ Abrir Painel Principal', 'menu:main')
            });
        });

        // Command: /status -> Diagnostic and Telemetry Status Report
        this.telegram.onCommand('status', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply(this.renderStatusReport(), {
                reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
            });
        });

        // Command: /config -> Settings Menu
        this.telegram.onCommand('config', ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply(this.renderSettingsMenu(), {
                reply_markup: WeatherTelegramBot.buildSettingsKeyboard(this.getConfig())
            });
        });

        // Command: /alertas -> On-demand multi-source active alerts (INMET + Defesa Civil RS)
        const handleAlertas = async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const report = await this.renderActiveAlertsReport();
            const chunks = splitTelegramMessage(report);
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar Alertas', 'action:active_alerts')
                .text('⬅️ Menu', 'menu:main');
            for (let i = 0; i < chunks.length; i += 1) {
                const isLast = i === chunks.length - 1;
                // eslint-disable-next-line no-await-in-loop
                await ctx.reply(chunks[i], { reply_markup: isLast ? kb : undefined });
            }
        };
        this.telegram.onCommand('alertas', handleAlertas);
        this.telegram.onCommand('inmet', handleAlertas);

        // Callback Query Router for Inline Buttons
        this.telegram.onCallbackQuery(async ctx => {
            const data = ctx.callbackQuery?.data || '';
            const answer = text => ctx.answerCallbackQuery?.(text ? { text } : undefined);

            // Shared read-only actions (regular + admin) — no live scan, safe for spam
            if (data === 'action:last_scan') {
                await answer('📋 Carregando último scan…');
                const report = this.renderLastScanReport();
                const chunks = splitTelegramMessage(report);
                const isAdminForKb = this.isAdmin(ctx);
                const kb = isAdminForKb
                    ? new InlineKeyboard().text('🔄 Atualizar', 'action:last_scan').text('⬅️ Menu', 'menu:main')
                    : new InlineKeyboard().text('🔄 Atualizar', 'action:last_scan').text('⬅️ Menu', 'menu:regular_main');
                if (chunks.length === 1) {
                    return ctx.editMessageText?.(chunks[0], { reply_markup: kb });
                }
                await ctx.editMessageText?.(chunks[0]);
                for (let i = 1; i < chunks.length; i += 1) {
                    const isLast = i === chunks.length - 1;
                    // eslint-disable-next-line no-await-in-loop
                    await ctx.reply?.(chunks[i], { reply_markup: isLast ? kb : undefined });
                }
                return;
            }
            if (data === 'action:regular_about') {
                await answer();
                return ctx.editMessageText?.(this.renderRegularAbout(), {
                    reply_markup: WeatherTelegramBot.buildRegularKeyboard()
                });
            }
            if (data === 'action:regular_help') {
                await answer();
                return ctx.editMessageText?.([
                    '🔑 USAR CÓDIGO DE CONVITE',
                    CARD_HEADER,
                    'Cole o código de 8 caracteres A-Z0-9 aqui como mensagem.',
                    'Exemplos:',
                    '• `AB12CD34`',
                    '• `meu código é AB12CD34 por favor` (o bot extrai)',
                    '• Link: `https://t.me/' + (this.getBotUsername() || 'seu_bot') + '?start=AB12CD34` → clique e depois [Aceitar]',
                    '',
                    'O código expira em 5 minutos e é de uso único.',
                    CARD_DIVIDER,
                    'Basta enviar o código agora neste chat.'
                ].join('\n'), {
                    reply_markup: new InlineKeyboard().text('⬅️ Voltar', 'menu:regular_main')
                });
            }
            if (data === 'menu:regular_main') {
                await answer();
                return ctx.editMessageText?.(buildRegularWelcomeMessage(), {
                    reply_markup: WeatherTelegramBot.buildRegularKeyboard()
                });
            }
            // Invite accept/reject — allowed for non-admin (invitee) via link or paste
            if (data.startsWith('action:invite_accept:')) {
                const code = data.split(':')[2] || '';
                const normalized = normalizeInviteCode(code);
                if (!INVITE_CODE_REGEX.test(normalized)) {
                    await answer('Código inválido');
                    return;
                }
                if (this.isAdmin(ctx)) {
                    await answer('Você já é administrador');
                    return ctx.editMessageText?.('ℹ️ Você já é administrador.', {
                        reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                    });
                }
                const chatId = String(ctx.chat?.id);
                const username = ctx.from?.username || null;
                const result = consumeInviteCode(normalized, chatId, { username });
                if (result.success) {
                    this.telegram.addAdminChatId(chatId);
                    this.syncAdminsFromStore();
                    await answer('✅ Convite aceito!');
                    return ctx.editMessageText?.([
                        '✅ CÓDIGO ACEITO — ACESSO LIBERADO',
                        CARD_HEADER,
                        `Bem-vindo! Seu chat \`${chatId}\` agora é administrador.`,
                        '',
                        'Você já pode usar:',
                        '• /start — painel principal',
                        '• /status — diagnóstico',
                        '• /config — ajustes',
                        '• /alertas — avisos ativos',
                        '',
                        CARD_DIVIDER,
                        '🔒 O código foi invalidado (uso único).'
                    ].join('\n'), { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
                }
                if (result.reason === 'already_admin') {
                    this.telegram.addAdminChatId(chatId);
                    await answer('Já é administrador');
                    return ctx.editMessageText?.('ℹ️ Você já é administrador.', {
                        reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                    });
                }
                if (result.reason === 'expired') {
                    await answer('Código expirado');
                    return ctx.editMessageText?.([
                        '⏰ CÓDIGO EXPIRADO',
                        CARD_HEADER,
                        `O código \`${normalized}\` expirou (5 minutos).`,
                        'Peça novo código ao administrador.'
                    ].join('\n'));
                }
                if (result.reason === 'revoked') {
                    await answer('Código revogado');
                    return ctx.editMessageText?.([
                        '🚫 CÓDIGO REVOGADO',
                        CARD_HEADER,
                        `O código \`${normalized}\` foi revogado.`,
                        'Peça novo código ao administrador.'
                    ].join('\n'));
                }
                await answer('Código inválido');
                return ctx.editMessageText?.([
                    '❌ CÓDIGO INVÁLIDO',
                    CARD_HEADER,
                    `O código \`${normalized}\` não é válido ou já foi usado.`,
                    'Peça novo código ao administrador em: ⚙️ Configurações → 👥 Convidar'
                ].join('\n'));
            }
            if (data.startsWith('action:invite_reject:')) {
                const code = data.split(':')[2] || '';
                await answer('Convite recusado');
                return ctx.editMessageText?.([
                    '❌ CONVITE RECUSADO',
                    CARD_HEADER,
                    `Você recusou o convite \`${normalizeInviteCode(code)}\`.`,
                    'Se mudar de ideia, peça novo código ao administrador.',
                    '',
                    CARD_DIVIDER,
                    'Você continua com acesso de leitura aos últimos alertas via “🚨 Ver Últimos Alertas”.'
                ].join('\n'), { reply_markup: WeatherTelegramBot.buildRegularKeyboard() });
            }
            if (data === 'action:bootstrap_accept') {
                const chatId = String(ctx.chat?.id);
                const totalAdmins = this.telegram.getAdminChatIds().length;
                if (totalAdmins !== 0) {
                    await answer('Já existe administrador');
                    return ctx.editMessageText?.([
                        'ℹ️ Já existe um administrador configurado.',
                        CARD_HEADER,
                        'Peça um código de convite ao administrador atual em:',
                        '⚙️ Configurações → 👥 Convidar Administrador'
                    ].join('\n'), { reply_markup: WeatherTelegramBot.buildRegularKeyboard() });
                }
                if (this.isAdmin(ctx)) {
                    await answer('Já é administrador');
                    return ctx.editMessageText?.('ℹ️ Você já é administrador.', {
                        reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                    });
                }
                const username = ctx.from?.username || null;
                const added = addPersistedAdminChatId(chatId, { addedBy: 'bootstrap', username });
                if (added) {
                    this.telegram.addAdminChatId(chatId);
                    this.syncAdminsFromStore();
                    await answer('✅ Bem-vindo, administrador!');
                    return ctx.editMessageText?.([
                        '✅ CÓDIGO ACEITO — ACESSO LIBERADO',
                        CARD_HEADER,
                        `Bem-vindo! Seu chat \`${chatId}\` agora é administrador principal.`,
                        '',
                        'Você já pode usar:',
                        '• /start — painel principal',
                        '• /status — diagnóstico',
                        '• /config — ajustes',
                        '• /alertas — avisos ativos',
                        '',
                        CARD_DIVIDER,
                        '🔒 Você pode agora convidar outros administradores em ⚙️ Configurações → 👥 Convidar.'
                    ].join('\n'), { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
                }
                await answer('Falha ao promover');
                return ctx.editMessageText?.('❌ Falha ao se tornar administrador. Tente novamente.', {
                    reply_markup: WeatherTelegramBot.buildRegularKeyboard()
                });
            }
            if (data === 'action:bootstrap_reject') {
                await answer('Convite recusado');
                return ctx.editMessageText?.([
                    '❌ CONVITE RECUSADO',
                    CARD_HEADER,
                    'Você recusou se tornar administrador.',
                    'Continuará com acesso de leitura aos últimos alertas.',
                    '',
                    CARD_DIVIDER,
                    'Você pode mudar de ideia e usar /start novamente enquanto não houver administrador.'
                ].join('\n'), { reply_markup: WeatherTelegramBot.buildRegularKeyboard() });
            }

            if (!this.isAdmin(ctx)) {
                await ctx.answerCallbackQuery?.({ text: 'Acesso restrito ao administrador.', show_alert: true });
                return this.replyUnauthorized(ctx);
            }

            const config = this.getConfig();

            // Admin invite management
            if (data === 'menu:admins') {
                await answer();
                const active = (() => { try { return getActiveInviteCode(); } catch { return null; } })();
                return ctx.editMessageText?.(this.renderAdminsMenu(), {
                    reply_markup: WeatherTelegramBot.buildAdminsKeyboard({ hasActiveCode: !!active })
                });
            }

            if (data === 'action:generate_invite') {
                const code = createAdminInviteCode(String(ctx.chat?.id || 'unknown'));
                await answer(`🎟️ Código gerado: ${code}`);
                return ctx.editMessageText?.(this.renderInviteGenerated(code), {
                    reply_markup: new InlineKeyboard()
                        .text('🔁 Gerar Novo Código', 'action:generate_invite')
                        .row()
                        .text('🚫 Revogar Código', 'action:revoke_invite')
                        .row()
                        .text('⬅️ Voltar', 'menu:admins')
                });
            }

            if (data === 'action:revoke_invite') {
                clearInviteCode();
                await answer('🚫 Código revogado.');
                return ctx.editMessageText?.(this.renderAdminsMenu(), {
                    reply_markup: WeatherTelegramBot.buildAdminsKeyboard({ hasActiveCode: false })
                });
            }

            // 1. Navigation Submenus
            if (data === 'menu:main') {
                await answer();
                return ctx.editMessageText?.(this.renderMainMenu(), {
                    reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                });
            }

            if (data === 'menu:settings') {
                await answer();
                return ctx.editMessageText?.(this.renderSettingsMenu(), {
                    reply_markup: WeatherTelegramBot.buildSettingsKeyboard(config)
                });
            }

            if (data === 'menu:interval') {
                await answer();
                const text = [
                    '⏱️ ESCOLHA O INTERVALO DE VARREDURA:',
                    CARD_HEADER,
                    `Intervalo ativo: A cada ${config.intervalMinutes} minutos`,
                    '',
                    'Selecione a nova frequência de monitoramento:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildIntervalKeyboard(config.intervalMinutes)
                });
            }

            if (data === 'menu:radius') {
                await answer();
                const text = [
                    '📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:',
                    CARD_HEADER,
                    `Raio ativo: ${config.radiusKm} km em torno de Charqueadas`,
                    '',
                    'Selecione o novo raio de varredura:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildRadiusKeyboard(config.radiusKm)
                });
            }

            if (data === 'menu:inmet_level') {
                await answer();
                const text = [
                    '🏛️ LIMIAR MÍNIMO DE ALERTA — INMET:',
                    CARD_HEADER,
                    `Limiar ativo: ${getTierBadge(config.inmetMinSeverity)}`,
                    '',
                    'Selecione o nível mínimo para acionamento de alertas do INMET:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildInmetLevelKeyboard(config.inmetMinSeverity)
                });
            }

            if (data === 'menu:defesa_civil_level') {
                await answer();
                const text = [
                    '🛡️ LIMIAR MÍNIMO DE ALERTA — DEFESA CIVIL RS:',
                    CARD_HEADER,
                    `Limiar ativo: ${getTierBadge(config.defesaCivilMinSeverity)}`,
                    '',
                    'Selecione o nível mínimo para acionamento de alertas da Defesa Civil:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildDefesaCivilLevelKeyboard(config.defesaCivilMinSeverity)
                });
            }

            if (data === 'menu:categories') {
                await answer();
                return ctx.editMessageText?.(this.renderCategoriesMenu(config.categoryMinSeverities), {
                    reply_markup: WeatherTelegramBot.buildCategoriesKeyboard(config.categoryMinSeverities)
                });
            }

            if (data.startsWith('menu:category:')) {
                const categoryId = data.split(':')[2];
                if (ALERT_CATEGORIES[categoryId]) {
                    await answer();
                    const currentTier = config.categoryMinSeverities?.[categoryId] ?? 'YELLOW';
                    return ctx.editMessageText?.(this.renderCategoryLevelMenu(categoryId, currentTier), {
                        reply_markup: WeatherTelegramBot.buildCategoryLevelKeyboard(categoryId, currentTier)
                    });
                }
                await answer();
                return;
            }

            if (data.startsWith('set_cat:')) {
                const parts = data.split(':');
                const categoryId = parts[1];
                const tier = parts[2];
                if (ALERT_CATEGORIES[categoryId] && tier) {
                    const normalized = normalizeSeverityTier(tier);
                    this.updateConfig({ categoryMinSeverities: { [categoryId]: normalized } });
                    await answer(`✅ ${ALERT_CATEGORIES[categoryId].emoji} ${ALERT_CATEGORIES[categoryId].label}: ${getTierBadge(normalized)}!`);
                    const fresh = this.getConfig();
                    const freshTier = fresh.categoryMinSeverities?.[categoryId] || normalized;
                    return ctx.editMessageText?.(this.renderCategoryLevelMenu(categoryId, freshTier), {
                        reply_markup: WeatherTelegramBot.buildCategoryLevelKeyboard(categoryId, freshTier)
                    });
                }
                await answer();
                return;
            }

            // 2. Settings Modifiers
            if (data.startsWith('set_interval:')) {
                const minutes = parseInt(data.split(':')[1], 10);
                const updated = this.updateConfig({ intervalMinutes: minutes });
                await answer(`✅ Intervalo atualizado para ${minutes} minutos!`);

                const text = [
                    '⏱️ ESCOLHA O INTERVALO DE VARREDURA:',
                    CARD_HEADER,
                    `Intervalo ativo: A cada ${updated.intervalMinutes} minutos`,
                    '',
                    'Selecione a nova frequência de monitoramento:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildIntervalKeyboard(updated.intervalMinutes)
                });
            }

            if (data.startsWith('set_radius:')) {
                const km = parseInt(data.split(':')[1], 10);
                const updated = this.updateConfig({ radiusKm: km });
                await answer(`✅ Raio regional atualizado para ${km} km!`);

                const text = [
                    '📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:',
                    CARD_HEADER,
                    `Raio ativo: ${updated.radiusKm} km em torno de Charqueadas`,
                    '',
                    'Selecione o novo raio de varredura:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildRadiusKeyboard(updated.radiusKm)
                });
            }

            if (data.startsWith('set_inmet:')) {
                const tier = data.split(':')[1];
                const updated = this.updateConfig({ inmetMinSeverity: tier });
                await answer(`✅ Limiar INMET atualizado para ${getTierBadge(tier)}!`);

                const text = [
                    '🏛️ LIMIAR MÍNIMO DE ALERTA — INMET:',
                    CARD_HEADER,
                    `Limiar ativo: ${getTierBadge(updated.inmetMinSeverity)}`,
                    '',
                    'Selecione o nível mínimo para acionamento de alertas do INMET:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildInmetLevelKeyboard(updated.inmetMinSeverity)
                });
            }

            if (data.startsWith('set_dc:')) {
                const tier = data.split(':')[1];
                const updated = this.updateConfig({ defesaCivilMinSeverity: tier });
                await answer(`✅ Limiar Defesa Civil atualizado para ${getTierBadge(tier)}!`);

                const text = [
                    '🛡️ LIMIAR MÍNIMO DE ALERTA — DEFESA CIVIL RS:',
                    CARD_HEADER,
                    `Limiar ativo: ${getTierBadge(updated.defesaCivilMinSeverity)}`,
                    '',
                    'Selecione o nível mínimo para acionamento de alertas da Defesa Civil:'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildDefesaCivilLevelKeyboard(updated.defesaCivilMinSeverity)
                });
            }

            // 3. Real-Time Action Buttons
            if (data === 'action:status') {
                await answer('🔍 Verificando status e banco...');
                return ctx.editMessageText?.(this.renderStatusReport(), {
                    reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                });
            }

            if (data === 'action:active_alerts' || data === 'action:inmet_warnings') {
                await answer('🚨 Consultando INMET e Defesa Civil...');
                const report = await this.renderActiveAlertsReport();
                const chunks = splitTelegramMessage(report);
                const kb = new InlineKeyboard()
                    .text('🔄 Atualizar', 'action:active_alerts')
                    .text('⬅️ Menu', 'menu:main');
                if (chunks.length === 1) {
                    return ctx.editMessageText?.(chunks[0], { reply_markup: kb });
                }
                await ctx.editMessageText?.(chunks[0]);
                for (let i = 1; i < chunks.length; i += 1) {
                    const isLast = i === chunks.length - 1;
                    // eslint-disable-next-line no-await-in-loop
                    await ctx.reply?.(chunks[i], { reply_markup: isLast ? kb : undefined });
                }
                return;
            }

            if (data === 'action:help') {
                await answer();
                const text = [
                    '📖 AJUDA E OPERAÇÃO DO PAINEL',
                    CARD_HEADER,
                    '• Status & Varredura: Diagnóstico em tempo real das métricas do serviço.',
                    '• Alertas Ativos: Varredura imediata dos avisos do INMET e alertas da Defesa Civil RS.',
                    '• Configurações: Altere raio, intervalo, limiares e categorias de alerta por tipo de evento.'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                });
            }
        });

        // Text handler: non-admins can redeem invite codes (A-Z0-9 8 chars); otherwise invite prompt
        this.telegram.onText(async ctx => {
            if (!this.isAdmin(ctx)) {
                const text = String(ctx.message?.text || '').trim();
                const inviteResult = await this.tryConsumeInviteCode(ctx, text);
                if (inviteResult) return inviteResult;
                return this.replyInviteRequired(ctx);
            }
            return ctx.reply('Use os botões do menu interativo ou digite /help para ver os comandos rápidos.', {
                reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
            });
        });

        // Global Error Handler
        this.telegram.onError(errorInfo => {
            this.logger.error?.('Telegram bot update failed:', errorInfo.error || errorInfo);
        });
    }
}
