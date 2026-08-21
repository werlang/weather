/**
 * Telegram Bot Presentation & Interactive UI Layer.
 * Provides an object-oriented WeatherTelegramBot class managing interactive menus,
 * inline button keyboards, visual telemetry gauges, high-contrast cards, and alert delivery.
 * 
 * Supports independent alert thresholds for INMET and DEFESA CIVIL RS.
 * 
 * @module telegramBot
 */

import { InlineKeyboard } from './telegram.js';
import { onHighRiskEventDetected, parseMonitorConfig } from './monitor_service.js';
import { getDefesaCivilTelemetry, REGIONAL_STATIONS } from './defesa_civil_client.js';
import { getSurroundingCities, getRegionalRiskWarnings, getAlertEmoji } from './inmet_client.js';
import { getFetchStats } from './log_database.js';


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
    { id: 'ORANGE', label: '🟠 Laranja (Alerta / Severo) ou superior', desc: 'Chuva >= 30mm/h, ventos >= 75km/h, subida rápida do Jacuí.' },
    { id: 'RED', label: '🔴 Vermelho (Alerta Máximo)', desc: 'Precipitação torrencial extrema e inundações iminentes.' },
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
 * Standard Telegram Bot command menu definition for autocomplete.
 */
export const BOT_COMMANDS = [
    { command: 'start', description: '🌤️ Painel meteorológico e menu interativo' },
    { command: 'menu', description: '🌤️ Abrir painel principal' },
    { command: 'status', description: '📊 Status do monitor e telemetria' },
    { command: 'jacui', description: '🌊 Rio Jacuí e dados da Defesa Civil RS' },
    { command: 'inmet', description: '⚡ Avisos meteorológicos oficiais' },
    { command: 'config', description: '⚙️ Ajustes de intervalo, raio e alertas' },
    { command: 'help', description: '📖 Ajuda e guia operacional' },
    { command: 'chatid', description: '🆔 Consultar ID deste chat Telegram' }
];

/**
 * Renders a visual Unicode gauge/progress meter.
 * E.g. [██████░░░░] 60%
 *
 * @param {number} value - Current value.
 * @param {number} max - Maximum scale value.
 * @param {number} [length=8] - Number of segments.
 * @param {string} [filledChar='█'] - Filled character.
 * @param {string} [emptyChar='░'] - Empty character.
 * @returns {string} E.g. "[████░░░░] 50%"
 */
export function renderProgressBar(value, max, length = 8, filledChar = '█', emptyChar = '░') {
    if (max <= 0 || value === null || value === undefined || isNaN(value)) {
        return `[${emptyChar.repeat(length)}]`;
    }
    const ratio = Math.max(0, Math.min(1, value / max));
    const filled = Math.round(ratio * length);
    const empty = Math.max(0, length - filled);
    const pct = Math.round(ratio * 100);
    return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}] ${pct}%`;
}

/**
 * Renders a descriptive river level trend with speed context.
 *
 * @param {number|undefined|null} trend - Trend in m/h.
 * @returns {string} Formatted trend indicator.
 */
export function renderRiverTrend(trend) {
    if (trend === undefined || trend === null || isNaN(trend)) return '';
    if (trend >= 0.25) return `🔺 Subida Crítica (+${trend} m/h)`;
    if (trend > 0) return `📈 Subindo (+${trend} m/h)`;
    if (trend === 0) return '➡️ Estável (0.00 m/h)';
    if (trend <= -0.25) return `🔻 Descida Rápida (${trend} m/h)`;
    return `📉 Descendo (${trend} m/h)`;
}

/**
 * Maps a severity string to a high-contrast visual badge.
 *
 * @param {string} severity
 * @returns {string}
 */
export function renderSeverityBadge(severity = '') {
    const lower = String(severity).toLowerCase();
    if (lower.includes('grande perigo') || lower.includes('máximo') || lower.includes('extremo') || lower.includes('red')) {
        return '🔴 GRANDE PERIGO (CRÍTICO)';
    }
    if (lower.includes('potencial') || lower.includes('amarelo') || lower.includes('yellow') || lower.includes('atenção')) {
        return '🟡 PERIGO POTENCIAL (MODERADO)';
    }
    if (lower.includes('perigo') || lower.includes('laranja') || lower.includes('orange') || lower.includes('alerta')) {
        return '🟠 PERIGO (SEVERO)';
    }
    return '🟢 NORMAL / MONITORAMENTO';
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
        if (update.radiusKm) this.localState.radiusKm = update.radiusKm;
        if (update.intervalMinutes) {
            this.localState.intervalMinutes = update.intervalMinutes;
            this.localState.intervalMs = update.intervalMinutes * 60 * 1000;
        }
        if (update.inmetMinSeverity) this.localState.inmetMinSeverity = normalizeSeverityTier(update.inmetMinSeverity);
        if (update.defesaCivilMinSeverity) this.localState.defesaCivilMinSeverity = normalizeSeverityTier(update.defesaCivilMinSeverity);
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
            'Este bot está restrito ao administrador configurado.',
            '',
            '💡 Use /chatid para consultar o ID deste chat e solicite autorização ao mantenedor do sistema.'
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
            .text('🌊 Jacuí & Telemetria', 'action:defesa_civil')
            .row()
            .text('⚡ Avisos Ativos INMET', 'action:inmet_warnings')
            .text('⚙️ Configurações', 'menu:settings')
            .row()
            .text('❓ Ajuda & Comandos', 'action:help')
            .text('🆔 Meu Chat ID', 'action:chatid');
    }

    /**
     * Builds the settings overview inline keyboard.
     *
     * @returns {InlineKeyboard}
     */
    static buildSettingsKeyboard() {
        return new InlineKeyboard()
            .text('⏱️ Alterar Intervalo', 'menu:interval')
            .text('📍 Alterar Raio Regional', 'menu:radius')
            .row()
            .text('🏛️ Nível Mínimo: INMET', 'menu:inmet_level')
            .row()
            .text('🛡️ Nível Mínimo: Defesa Civil', 'menu:defesa_civil_level')
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
            .text('🌊 Ver Jacuí & Chuva', 'action:defesa_civil')
            .text('⚡ Avisos INMET', 'action:inmet_warnings')
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
            'Monitoramento 24/7 de Riscos e Telemetria Hidrometeorológica',
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
            '📈 Métricas de Telemetria & Banco (SQLite):',
            stats ? `  - Requisições Registradas: ${stats.totalFetches} (${stats.successfulFetches} OK)` : '  - Banco SQLite conectado',
            stats ? `  - Tempo Médio de Resposta: ${Math.round(stats.avgDurationMs || 0)} ms` : '',
            stats ? `  - Alertas Históricos Gravados: ${stats.totalAlertsRecorded}` : '',
            CARD_DIVIDER,
            `🕒 Consulta realizada em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        ].filter(Boolean).join('\n');
    }

    /**
     * Renders real-time Defesa Civil RS river and weather telemetry with visual progress gauges.
     * 
     * @returns {Promise<string>}
     */
    async renderDefesaCivilTelemetryReport() {
        try {
            const stations = await getDefesaCivilTelemetry(['DCRS-00032', 'DCRS-00093', 'DCRS-00076', 'DCRS-00054']);
            const lines = [
                '🌊 TELEMETRIA HIDROMETEOROLÓGICA — DEFESA CIVIL RS',
                CARD_HEADER,
                `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                ''
            ];

            if (!stations || stations.length === 0) {
                lines.push('⚠️ Telemetria temporariamente indisponível na rede estadual.');
                return lines.join('\n');
            }

            stations.forEach(st => {
                const meta = REGIONAL_STATIONS.find(s => s.code === st.codigo) || { name: st.name?.local || st.codigo, river: 'Rio Baixo Jacuí' };
                const data = st.data || {};

                const riverLevel = data.rio?.rio_nivel?.value;
                const riverTrend = data.rio?.rio_nivel_tendencia?.value;
                const rain15min = data.chuva?.acumulado?.min015?.value;
                const rain1h = data.chuva?.acumulado?.h001?.value;
                const rain3h = data.chuva?.acumulado?.h003?.value;
                const rain24h = data.chuva?.acumulado?.h024?.value;
                const wind = data.vento?.velocidade_maxima?.value;
                const temp = data.temperatura?.atual?.value;
                const humidity = data.umidade?.atual?.value;

                lines.push(`📍 ${meta.name} (${st.codigo})`);

                if (riverLevel !== undefined && riverLevel !== null) {
                    const trendStr = renderRiverTrend(riverTrend);
                    lines.push(`  🌊 ${meta.river}: ${riverLevel} m ${trendStr ? `• ${trendStr}` : ''}`);
                }

                // Visual Rain Gauge (scale 0-50mm/h)
                const rainGauge = renderProgressBar(rain1h ?? 0, 50, 6);
                lines.push(`  🌧️ Chuva 1h: ${rain1h ?? 0} mm ${rainGauge} | 15min: ${rain15min ?? 0}mm | 24h: ${rain24h ?? 0}mm`);

                if (wind !== undefined) {
                    const windGauge = renderProgressBar(wind, 100, 6);
                    lines.push(`  💨 Rajada Vento: ${wind} km/h ${windGauge}`);
                }

                if (temp !== undefined || humidity !== undefined) {
                    lines.push(`  🌡️ Temp: ${temp ?? 'N/A'}°C | Umidade: ${humidity ?? 'N/A'}%`);
                }

                lines.push('');
            });

            lines.push(CARD_DIVIDER);
            lines.push('💡 Dados oficiais transmitidos por estações telemétricas da Defesa Civil RS.');
            return lines.join('\n');
        } catch (err) {
            return `❌ Erro ao consultar telemetria da Defesa Civil RS: ${err.message}`;
        }
    }

    /**
     * Renders active INMET warnings in the monitored regional area.
     * 
     * @param {number} [radiusKm]
     * @returns {Promise<string>}
     */
    async renderInmetWarningsReport(radiusKm) {
        try {
            const targetRadius = radiusKm || this.getConfig().radiusKm;
            const cities = await getSurroundingCities(targetRadius);
            const { regionalWarnings } = await getRegionalRiskWarnings(cities);

            const lines = [
                '⚡ AVISOS METEOROLÓGICOS OFICIAIS (INMET)',
                CARD_HEADER,
                `Raio monitorado: ${targetRadius} km (${cities.length} municípios)`,
                `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                ''
            ];

            if (regionalWarnings.length === 0) {
                lines.push('🟢 Nenhum aviso meteorológico ativo emitido para a região no momento.');
                lines.push('', CARD_DIVIDER);
                lines.push('💡 O monitoramento continua 24/7 a cada ciclo agendado.');
                return lines.join('\n');
            }

            regionalWarnings.forEach((w, idx) => {
                const emoji = getAlertEmoji(w);
                const citiesStr = (w.affectedRegionalCities || []).join(', ') || 'Região Metropolitana';

                lines.push(`${idx + 1}. ${emoji} ${w.descricao || w.tipo || 'Aviso Meteorológico'}`);
                lines.push(`   Severidade: ${w.severidade || 'Não informada'}`);
                lines.push(`   Período: ${w.inicio || 'N/A'} -> ${w.fim || 'N/A'}`);
                lines.push(`   Municípios Afetados: ${citiesStr}`);

                if (w.riscos) {
                    const rText = Array.isArray(w.riscos) ? w.riscos.join(' | ') : w.riscos;
                    lines.push(`   Riscos: ${rText}`);
                }
                lines.push('');
            });

            lines.push(CARD_DIVIDER);
            lines.push('⚠️ Fonte: Instituto Nacional de Meteorologia (INMET / CPTEC).');
            return lines.join('\n');
        } catch (err) {
            return `❌ Erro ao consultar avisos do INMET: ${err.message}`;
        }
    }

    /**
     * Formats detected high-risk events as high-contrast plain text for Telegram broadcasts.
     *
     * @param {Array<object>} events - High-risk events from the risk analyzer.
     * @param {Date} [sentAt=new Date()] - Timestamp shown in the alert header.
     * @returns {string} Formatted alert message.
     */
    static formatHighRiskAlert(events, sentAt = new Date()) {
        const lines = [
            '🚨 ALERTA METEOROLÓGICO SEVERO',
            '🏫 CRITÉRIO: AVALIAÇÃO DE SUSPENSÃO DE AULAS / ATIVIDADES',
            CARD_HEADER,
            `🕒 Detectado em: ${sentAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
            `📊 Eventos Críticos Detectados: ${events.length}`,
            ''
        ];

        events.forEach((event, index) => {
            const badge = renderSeverityBadge(event.severity);
            lines.push(`${index + 1}. ${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico severo'}`);
            lines.push(`   Severidade: ${badge}`);
            lines.push(`   Origem: ${event.source || 'Não informada'}`);
            lines.push(`   Municípios Impactados: ${(event.affectedCities || []).join(', ') || 'Não informados'}`);
            lines.push(`   Janela: ${event.timeframe || 'Não informada'}`);
            lines.push(`   💡 Motivo do Disparo: ${event.triggerReason || 'Não informado'}`);

            if (event.details && event.details !== event.triggerReason) {
                lines.push(`   📝 Detalhes: ${event.details}`);
            }
            if (index < events.length - 1) lines.push('', CARD_DIVIDER, '');
        });

        lines.push('', CARD_HEADER);
        lines.push('⚠️ Recomenda-se acionar o plano de contingência e avaliar a segurança no transporte escolar.');

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
                '• /jacui — Exibe a telemetria ao vivo do Rio Jacuí e Defesa Civil RS',
                '• /inmet — Exibe os alertas ativos do INMET na região',
                '• /chatid — Informa o ID deste chat para fins de autorização',
                '',
                CARD_DIVIDER,
                '💡 Todas as opções acima também estão disponíveis nos botões do painel.'
            ].join('\n');

            return ctx.reply(text, {
                reply_markup: new InlineKeyboard().text('🌤️ Abrir Painel Principal', 'menu:main')
            });
        });

        // Command: /chatid -> Print current Chat ID
        this.telegram.onCommand('chatid', ctx => {
            const chatId = ctx.chat?.id;
            return ctx.reply(`ID deste chat: ${chatId ?? 'indisponível'}`);
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
                reply_markup: WeatherTelegramBot.buildSettingsKeyboard()
            });
        });

        // Command: /jacui -> Live Defesa Civil Telemetry
        this.telegram.onCommand('jacui', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const report = await this.renderDefesaCivilTelemetryReport();
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar Telemetria', 'action:defesa_civil')
                .text('⬅️ Menu', 'menu:main');
            return ctx.reply(report, { reply_markup: kb });
        });

        // Command: /inmet -> Live Active INMET Warnings
        this.telegram.onCommand('inmet', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const report = await this.renderInmetWarningsReport();
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar Avisos', 'action:inmet_warnings')
                .text('⬅️ Menu', 'menu:main');
            return ctx.reply(report, { reply_markup: kb });
        });

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
                    reply_markup: WeatherTelegramBot.buildSettingsKeyboard()
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
                    'Selecione o nível mínimo para acionamento de telemetria da Defesa Civil:'
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
                    'Selecione o nível mínimo para acionamento de telemetria da Defesa Civil:'
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

            if (data === 'action:defesa_civil') {
                await answer('🌊 Carregando telemetria...');
                const report = await this.renderDefesaCivilTelemetryReport();
                const kb = new InlineKeyboard()
                    .text('🔄 Atualizar', 'action:defesa_civil')
                    .text('⬅️ Menu', 'menu:main');
                return ctx.editMessageText?.(report, { reply_markup: kb });
            }

            if (data === 'action:inmet_warnings') {
                await answer('⚡ Consultando INMET...');
                const report = await this.renderInmetWarningsReport();
                const kb = new InlineKeyboard()
                    .text('🔄 Atualizar', 'action:inmet_warnings')
                    .text('⬅️ Menu', 'menu:main');
                return ctx.editMessageText?.(report, { reply_markup: kb });
            }

            if (data === 'action:help') {
                await answer();
                const text = [
                    '📖 AJUDA E OPERAÇÃO DO PAINEL',
                    CARD_HEADER,
                    '• Status & Varredura: Diagnóstico em tempo real das métricas do serviço.',
                    '• Jacuí & Telemetria: Monitoramento telemétrico do Rio Jacuí e bacias.',
                    '• Avisos INMET: Consulta imediata aos boletins oficiais de perigo.',
                    '• Configurações: Altere raio, intervalo e limiares independentes por instituto.'
                ].join('\n');

                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
                });
            }

            if (data === 'action:chatid') {
                await answer();
                return ctx.editMessageText?.(`🆔 ID deste chat: ${ctx.chat?.id ?? 'indisponível'}`, {
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

