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
import { onHighRiskEventDetected, parseMonitorConfig, performRegionalRiskMonitoring } from './monitor_service.js';
import { getFetchStats, saveSystemSetting } from './log_database.js';
import { aggregateRiskEvents, normalizeSeverityTier } from './risk_analyzer.js';


/**
 * Unicode visual divider constants for high-contrast card UI.
 */
export const CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const CARD_DIVIDER = '─────────────────────────';

/**
 * Standardized alert policies and criteria for educational & municipal safety.
 */
export const ALERT_POLICIES = {
    school: {
        id: 'school',
        label: '🏫 Escola (Laranja Defesa Civil / Vermelho INMET)',
        description: 'Recomendação de cancelamento/suspensão de aulas. Filtra frio de rotina e aciona apenas temporais/alagamentos severos e avisos vermelhos.'
    },
    red_only: {
        id: 'red_only',
        label: '🔴 Apenas Vermelho Extremo (Grande Perigo)',
        description: 'Aciona estritamente para alertas vermelhos oficiais do INMET ou Defesa Civil RS.'
    },
    all: {
        id: 'all',
        label: '🟡 Todos os Níveis (Amarelo, Laranja e Vermelho)',
        description: 'Modo informativo amplo para todos os avisos de perigo potencial e moderados.'
    }
};


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
    const normalizedTier = normalizeSeverityTier(event.colorTier);
    if (normalizedTier !== 'OFF') return normalizedTier;

    const severity = String(event.severity || '').toLowerCase();
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

        this.localState = {
            radiusKm: 50,
            intervalMinutes: 15,
            intervalMs: 15 * 60 * 1000,
            inmetMinSeverity: 'RED',
            defesaCivilMinSeverity: 'ORANGE'
        };

        this.registerHandlers();
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
     * @returns {{ radiusKm: number, intervalMinutes: number, intervalMs: number, inmetMinSeverity: string, defesaCivilMinSeverity: string }}
     */
    getConfig() {
        if (this.monitorService?.getConfig) {
            return this.monitorService.getConfig();
        }
        const base = parseMonitorConfig();
        return {
            radiusKm: this.localState.radiusKm || base.radiusKm,
            intervalMinutes: this.localState.intervalMinutes || base.intervalMinutes,
            intervalMs: this.localState.intervalMs || base.intervalMs,
            inmetMinSeverity: this.localState.inmetMinSeverity || base.inmetMinSeverity,
            defesaCivilMinSeverity: this.localState.defesaCivilMinSeverity || base.defesaCivilMinSeverity
        };
    }

    /**
     * Updates runtime configuration for the monitor service or local fallback state.
     * 
     * @param {object} update
     * @param {number} [update.radiusKm]
     * @param {number} [update.intervalMinutes]
     * @param {string} [update.inmetMinSeverity]
     * @param {string} [update.defesaCivilMinSeverity]
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
        return this.getConfig();
    }

    /**
     * Checks if a Telegram chat context originates from an authorized administrator.
     * 
     * @param {object} ctx - grammY context.
     * @returns {boolean}
     */
    isAdmin(ctx) {
        return this.telegram.isAdminChat(ctx.chat?.id);
    }

    /**
     * Sends the standardized unauthorized access response.
     * 
     * @param {object} ctx - grammY context.
     * @returns {Promise<object>}
     */
    replyUnauthorized(ctx) {
        return ctx.reply([
            '🔒 ACESSO RESTRITO',
            CARD_HEADER,
            'Este bot está restrito ao administrador configurado.'
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
     * Builds the primary inline keyboard for the bot main dashboard.
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
     * Builds the settings overview inline keyboard, showing the current color
     * circle badge of each provider's minimum alert level.
     *
     * @param {object} [config] - Active monitoring configuration.
     * @param {string} [config.inmetMinSeverity] - Current INMET minimum severity tier.
     * @param {string} [config.defesaCivilMinSeverity] - Current Defesa Civil RS minimum severity tier.
     * @returns {InlineKeyboard}
     */
    static buildSettingsKeyboard(config = {}) {
        return new InlineKeyboard()
            .text('⏱️ Alterar Intervalo', 'menu:interval')
            .text('📍 Alterar Raio Regional', 'menu:radius')
            .row()
            .text(`🏛️ Limiar INMET: ${getTierShortBadge(config.inmetMinSeverity)}`, 'menu:inmet_level')
            .row()
            .text(`🛡️ Limiar Defesa Civil: ${getTierShortBadge(config.defesaCivilMinSeverity)}`, 'menu:defesa_civil_level')
            .row()
            .text('⬅️ Voltar ao Menu Principal', 'menu:main');
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
     * Builds the alert policy selection inline keyboard with active indicator.
     *
     * @param {string} [currentPolicy='school']
     * @returns {InlineKeyboard}
     */
    static buildAlertLevelKeyboard(currentPolicy = 'school') {
        const kb = new InlineKeyboard();
        Object.values(ALERT_POLICIES).forEach(p => {
            const isCurrent = currentPolicy === p.id;
            const label = `${isCurrent ? '✅ ' : ''}${p.label}`;
            kb.text(label, `set_alert:${p.id}`).row();
        });
        kb.text('⬅️ Voltar às Configurações', 'menu:settings');
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
        return [
            '⚙️ CONFIGURAÇÕES DO MONITOR',
            CARD_HEADER,
            `• Raio Regional:          ${config.radiusKm} km`,
            `• Intervalo de Varredura:  A cada ${config.intervalMinutes} minutos`,
            `• Limiar Alerta INMET:     ${getTierBadge(config.inmetMinSeverity)}`,
            `• Limiar Defesa Civil RS:  ${getTierBadge(config.defesaCivilMinSeverity)}`,
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
     * Registers standard bot commands with Telegram autocomplete.
     *
     * @returns {Promise<boolean>}
     */
    async initCommands() {
        return this.telegram.setMyCommands?.(BOT_COMMANDS);
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
        const handleStart = async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const text = this.renderMainMenu();
            return ctx.reply(text, { reply_markup: WeatherTelegramBot.buildMainMenuKeyboard() });
        };

        this.telegram.onCommand('start', handleStart);
        this.telegram.onCommand('menu', handleStart);

        // Command: /help -> Help and Command List
        this.telegram.onCommand('help', ctx => {
            const text = [
                '📖 GUIA OPERACIONAL & COMANDOS DO BOT',
                CARD_HEADER,
                'Comandos rápidos disponíveis no chat:',
                '',
                '• /start ou /menu — Abre o painel interativo com botões de navegação',
                '• /status — Exibe o status da varredura e métricas do banco SQLite',
                '• /config — Ajusta raio, intervalo e limiares independentes por instituto',
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
            if (!this.isAdmin(ctx)) {
                await ctx.answerCallbackQuery?.({ text: 'Acesso restrito ao administrador.', show_alert: true });
                return this.replyUnauthorized(ctx);
            }

            const data = ctx.callbackQuery?.data || '';
            const answer = text => ctx.answerCallbackQuery?.(text ? { text } : undefined);
            const config = this.getConfig();

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
                    '• Configurações: Altere raio, intervalo e limiares independentes por instituto.'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                });
            }
        });

        // Unrecognized text handler
        this.telegram.onText(ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
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
