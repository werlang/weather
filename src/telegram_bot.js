/**
 * Telegram Bot Presentation & Interactive UI Layer.
 * Provides an object-oriented WeatherTelegramBot class managing interactive menus,
 * inline button keyboards, runtime configuration adjustments, and alert delivery.
 *
 * @module telegramBot
 */

import { InlineKeyboard } from './telegram.js';
import { onHighRiskEventDetected, parseMonitorConfig } from './monitor_service.js';
import { getDefesaCivilTelemetry, REGIONAL_STATIONS } from './defesa_civil_client.js';
import { getSurroundingCities, getRegionalRiskWarnings, getAlertEmoji } from './inmet_client.js';
import { getFetchStats } from './log_database.js';

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
 * Object-oriented controller for the Weather Telegram Bot interface.
 * Encapsulates bot lifecycle, admin authorization, interactive UI dashboards,
 * settings adjustments, and severe alert broadcasts.
 */
export class WeatherTelegramBot {
    /**
     * @param {object} options
     * @param {import('./telegram.js').TelegramBotClient} options.telegram - Bot wrapper client.
     * @param {object} [options.monitorService] - Running monitor service for live config updates.
     * @param {() => string} [options.getStatus] - Optional status message provider.
     * @param {Console} [options.logger=console] - Logger for errors and telemetry.
     */
    constructor({ telegram, monitorService = null, getStatus = null, logger = console }) {
        if (!telegram) {
            throw new Error('A Telegram bot client is required.');
        }

        this.telegram = telegram;
        this.monitorService = monitorService;
        this.getStatus = getStatus;
        this.logger = logger;

        this.localState = {
            radiusKm: 50,
            intervalMinutes: 15,
            intervalMs: 15 * 60 * 1000,
            alertPolicy: 'school'
        };

        this.#registerHandlers();
    }

    /**
     * Updates or binds a running monitor service instance to the bot.
     *
     * @param {object} monitorService
     */
    setMonitorService(monitorService) {
        this.monitorService = monitorService;
    }

    /**
     * Retrieves the active monitoring and alert configuration.
     *
     * @returns {{ radiusKm: number, intervalMinutes: number, intervalMs: number, alertPolicy: string }}
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
            alertPolicy: this.localState.alertPolicy || 'school'
        };
    }

    /**
     * Updates runtime configuration for the monitor service or local fallback state.
     *
     * @param {object} update
     * @param {number} [update.radiusKm]
     * @param {number} [update.intervalMinutes]
     * @param {string} [update.policy]
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
        if (update.policy) this.localState.alertPolicy = update.policy;
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
            '🔒 Este bot está restrito ao administrador configurado.',
            'Use /chatid para consultar o ID deste chat e peça ao responsável pela configuração que o autorize.'
        ].join('\n'));
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
            .text('❓ Ajuda', 'action:help')
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
            .row()
            .text('📍 Alterar Raio Regional', 'menu:radius')
            .row()
            .text('🚨 Nível de Alertas (Critério)', 'menu:alert_level')
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
        const policyLabel = ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy;
        return [
            '🌤️ PAINEL METEOROLÓGICO — CHARQUEADAS / RS',
            'Monitoramento 24/7 de Riscos e Telemetria Hidrometeorológica',
            '',
            '📍 Município Central: Charqueadas - RS (IBGE 4305355)',
            `📏 Raio de Cobertura: ${config.radiusKm} km`,
            `⏱️ Intervalo de Varredura: A cada ${config.intervalMinutes} min`,
            `🚨 Política de Alertas: ${policyLabel}`,
            '',
            'Selecione uma opção nos botões abaixo:'
        ].join('\n');
    }

    /**
     * Renders the settings menu text.
     *
     * @returns {string}
     */
    renderSettingsMenu() {
        const config = this.getConfig();
        const policy = ALERT_POLICIES[config.alertPolicy] || { label: config.alertPolicy, description: '' };
        return [
            '⚙️ CONFIGURAÇÕES DO MONITOR',
            '',
            `• Raio Regional:        ${config.radiusKm} km`,
            `• Intervalo de Varredura: A cada ${config.intervalMinutes} minutos`,
            `• Nível de Alerta:       ${policy.label}`,
            `  ↳ ${policy.description}`,
            '',
            'Escolha o parâmetro que deseja ajustar:'
        ].join('\n');
    }

    /**
     * Renders real-time Defesa Civil RS river and weather telemetry.
     *
     * @returns {Promise<string>}
     */
    async renderDefesaCivilTelemetryReport() {
        try {
            const stations = await getDefesaCivilTelemetry(['DCRS-00032', 'DCRS-00093', 'DCRS-00076', 'DCRS-00054']);
            const lines = [
                '🌊 TELEMETRIA HIDROMETEOROLÓGICA — DEFESA CIVIL RS',
                `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                ''
            ];

            if (!stations || stations.length === 0) {
                lines.push('⚠️ Telemetria temporariamente indisponível na rede estadual.');
                return lines.join('\n');
            }

            stations.forEach(st => {
                const meta = REGIONAL_STATIONS.find(s => s.code === st.codigo) || { name: st.name?.local || st.codigo, river: 'Rio Jacuí' };
                const data = st.data || {};
                const riverLevel = data.rio?.rio_nivel?.value;
                const riverTrend = data.rio?.rio_nivel_tendencia?.value;
                const rain15min = data.chuva?.acumulado?.min015?.value;
                const rain1h = data.chuva?.acumulado?.h001?.value;
                const rain24h = data.chuva?.acumulado?.h024?.value;
                const wind = data.vento?.velocidade_maxima?.value;
                const temp = data.temperatura?.atual?.value;

                lines.push(`📍 ${meta.name} (${st.codigo})`);
                if (riverLevel !== undefined && riverLevel !== null) {
                    const trendStr = riverTrend !== undefined ? ` (Tendência: ${riverTrend >= 0 ? '+' : ''}${riverTrend} m/h)` : '';
                    lines.push(`  🌊 ${meta.river}: ${riverLevel} m${trendStr}`);
                }
                lines.push(`  🌧️ Chuva: 15min: ${rain15min ?? 0}mm | 1h: ${rain1h ?? 0}mm | 24h: ${rain24h ?? 0}mm`);
                if (wind !== undefined) lines.push(`  💨 Rajada Máxima de Vento: ${wind} km/h`);
                if (temp !== undefined) lines.push(`  🌡️ Temperatura: ${temp}°C`);
                lines.push('');
            });

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
        const radius = radiusKm || this.getConfig().radiusKm;
        try {
            const cities = await getSurroundingCities(radius);
            const { regionalWarnings } = await getRegionalRiskWarnings(cities);

            const lines = [
                '⚡ AVISOS METEOROLÓGICOS OFICIAIS (INMET)',
                `Raio monitorado: ${radius} km (${cities.length} municípios)`,
                `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                ''
            ];

            if (regionalWarnings.length === 0) {
                lines.push('🟢 Nenhum aviso meteorológico ativo emitido para a região no momento.');
                return lines.join('\n');
            }

            regionalWarnings.forEach((w, idx) => {
                const emoji = getAlertEmoji(w);
                const citiesStr = (w.affectedRegionalCities || []).join(', ') || 'Região Metropolitana';
                lines.push(`${idx + 1}. ${emoji} ${w.descricao || w.tipo || 'Aviso Meteorológico'}`);
                lines.push(`   Severidade: ${w.severidade || 'Não informada'}`);
                lines.push(`   Período: ${w.inicio || 'N/A'} -> ${w.fim || 'N/A'}`);
                lines.push(`   Municípios: ${citiesStr}`);
                if (w.riscos) {
                    const rText = Array.isArray(w.riscos) ? w.riscos.join(' | ') : w.riscos;
                    lines.push(`   Riscos: ${rText}`);
                }
                lines.push('');
            });

            return lines.join('\n');
        } catch (err) {
            return `❌ Erro ao consultar avisos do INMET: ${err.message}`;
        }
    }

    /**
     * Renders the operational status report text.
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
            '✅ MONITOR METEOROLÓGICO OPERACIONAL',
            `• Raio Regional: ${config.radiusKm} km`,
            `• Intervalo de Varredura: A cada ${config.intervalMinutes} min`,
            `• Política de Alertas: ${ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy}`,
            stats ? `• Requisições Registradas (SQLite): ${stats.totalFetches} (${stats.successfulFetches} OK)` : '',
            stats ? `• Alertas Históricos no Banco: ${stats.totalAlertsRecorded}` : '',
            '• Ponto Central: Charqueadas - RS (IBGE 4305355)'
        ].filter(Boolean).join('\n');
    }

    // =========================================================================
    // ALERT FORMATTING & DISPATCH
    // =========================================================================

    /**
     * Formats detected high-risk events as plain Telegram text.
     *
     * @param {Array<object>} events - High-risk events from the risk analyzer.
     * @param {Date} [sentAt=new Date()] - Timestamp shown in the alert header.
     * @returns {string} Formatted alert message.
     */
    static formatHighRiskAlert(events, sentAt = new Date()) {
        const lines = [
            '🚨 ALERTA METEOROLÓGICO SEVERO',
            '🏫 CRITÉRIO: AVALIAÇÃO DE SUSPENSÃO DE AULAS / ATIVIDADES',
            `Detectado em: ${sentAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
            `Eventos Críticos: ${events.length}`,
            ''
        ];

        events.forEach((event, index) => {
            lines.push(`${index + 1}. ${event.emoji || '⚠️'} ${event.type || 'Evento meteorológico severo'}`);
            lines.push(`Severidade: ${event.severity || 'Não informada'}`);
            lines.push(`Origem: ${event.source || 'Não informada'}`);
            lines.push(`Municípios: ${(event.affectedCities || []).join(', ') || 'Não informados'}`);
            lines.push(`Janela: ${event.timeframe || 'Não informada'}`);
            lines.push(`Motivo: ${event.triggerReason || 'Não informado'}`);
            if (event.details && event.details !== event.triggerReason) {
                lines.push(`Detalhes: ${event.details}`);
            }
            if (index < events.length - 1) lines.push('', '────────────────────', '');
        });

        return lines.join('\n');
    }

    /**
     * Sends a formatted high-risk alert through the Telegram client.
     *
     * @param {Array<object>} events - High-risk events to deliver.
     * @param {Date} [sentAt] - Optional timestamp for deterministic tests.
     * @returns {Promise<object>} Delivery summary.
     */
    sendHighRiskAlerts(events, sentAt) {
        return this.telegram.sendToAdmins(WeatherTelegramBot.formatHighRiskAlert(events, sentAt));
    }

    /**
     * Creates the monitor callback that logs locally and delivers alerts to administrators.
     *
     * @returns {(events: Array<object>) => Promise<object>} Alert callback.
     */
    createAlertCallback() {
        return async events => {
            onHighRiskEventDetected(events);
            const delivery = await this.sendHighRiskAlerts(events);
            if (delivery.failed.length > 0) {
                this.logger.error?.(`Telegram alert delivery failed for ${delivery.failed.length} administrator chat(s).`);
            }
            return delivery;
        };
    }

    // =========================================================================
    // BOT LIFECYCLE
    // =========================================================================

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

    // =========================================================================
    // HANDLERS REGISTRATION & ROUTING
    // =========================================================================

    /**
     * Registers all command and event listeners on the underlying Telegram client.
     * @private
     */
    #registerHandlers() {
        // Command: /start & /menu
        const handleStart = async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply(this.renderMainMenu(), {
                reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
            });
        };

        this.telegram.onCommand('start', handleStart);
        this.telegram.onCommand('menu', handleStart);

        // Command: /help
        this.telegram.onCommand('help', ctx => {
            const text = [
                '📖 AJUDA DO BOT METEOROLÓGICO',
                '',
                'Comandos rápidos disponíveis:',
                '• /start ou /menu — Abre o painel interativo com botões',
                '• /status — Exibe o status da varredura e métricas do banco',
                '• /config — Abre as opções de configuração de intervalo, raio e alertas',
                '• /jacui — Exibe a telemetria ao vivo do Rio Jacuí e Defesa Civil RS',
                '• /inmet — Exibe os alertas ativos do INMET na região',
                '• /chatid — Informa o ID deste chat para autorização'
            ].join('\n');
            return ctx.reply(text, {
                reply_markup: new InlineKeyboard().text('🌤️ Abrir Painel Principal', 'menu:main')
            });
        });

        // Command: /chatid
        this.telegram.onCommand('chatid', ctx => {
            const chatId = ctx.chat?.id;
            return ctx.reply(`ID deste chat: ${chatId ?? 'indisponível'}`);
        });

        // Command: /status
        this.telegram.onCommand('status', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply(this.renderStatusReport(), {
                reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
            });
        });

        // Command: /config
        this.telegram.onCommand('config', ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply(this.renderSettingsMenu(), {
                reply_markup: WeatherTelegramBot.buildSettingsKeyboard()
            });
        });

        // Command: /jacui
        this.telegram.onCommand('jacui', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const report = await this.renderDefesaCivilTelemetryReport();
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar Telemetria', 'action:defesa_civil')
                .text('⬅️ Menu', 'menu:main');
            return ctx.reply(report, { reply_markup: kb });
        });

        // Command: /inmet
        this.telegram.onCommand('inmet', async ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            const report = await this.renderInmetWarningsReport();
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar Avisos', 'action:inmet_warnings')
                .text('⬅️ Menu', 'menu:main');
            return ctx.reply(report, { reply_markup: kb });
        });

        // Callback Query Router
        this.telegram.onCallbackQuery(async ctx => {
            if (!this.isAdmin(ctx)) {
                await ctx.answerCallbackQuery?.({ text: 'Acesso restrito.', show_alert: true });
                return this.replyUnauthorized(ctx);
            }

            const data = ctx.callbackQuery?.data || '';
            const answer = text => ctx.answerCallbackQuery?.(text ? { text } : undefined);
            const config = this.getConfig();

            // 1. Navigation Menus
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
                const text = `⏱️ ESCOLHA O INTERVALO DE VARREDURA:\n(Intervalo atual: a cada ${config.intervalMinutes} min)`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildIntervalKeyboard(config.intervalMinutes)
                });
            }

            if (data === 'menu:radius') {
                await answer();
                const text = `📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:\n(Raio atual: ${config.radiusKm} km)`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildRadiusKeyboard(config.radiusKm)
                });
            }

            if (data === 'menu:alert_level') {
                await answer();
                const text = `🚨 ESCOLHA O NÍVEL DE SENSIBILIDADE DE ALERTA:\n(Nível atual: ${ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy})`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildAlertLevelKeyboard(config.alertPolicy)
                });
            }

            // 2. Settings Updates (Interval, Radius, Alert Policy)
            if (data.startsWith('set_interval:')) {
                const minutes = parseInt(data.split(':')[1], 10);
                const updated = this.updateConfig({ intervalMinutes: minutes });
                await answer(`✅ Intervalo atualizado para ${minutes} minutos!`);
                const text = `⏱️ ESCOLHA O INTERVALO DE VARREDURA:\n(Intervalo atual: a cada ${updated.intervalMinutes} min)`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildIntervalKeyboard(updated.intervalMinutes)
                });
            }

            if (data.startsWith('set_radius:')) {
                const km = parseInt(data.split(':')[1], 10);
                const updated = this.updateConfig({ radiusKm: km });
                await answer(`✅ Raio regional atualizado para ${km} km!`);
                const text = `📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:\n(Raio atual: ${updated.radiusKm} km)`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildRadiusKeyboard(updated.radiusKm)
                });
            }

            if (data.startsWith('set_alert:')) {
                const policyKey = data.split(':')[1];
                const updated = this.updateConfig({ policy: policyKey });
                await answer('✅ Política de alerta atualizada!');
                const text = `🚨 ESCOLHA O NÍVEL DE SENSIBILIDADE DE ALERTA:\n(Nível atual: ${ALERT_POLICIES[updated.alertPolicy]?.label || updated.alertPolicy})`;
                return ctx.editMessageText?.(text, {
                    reply_markup: WeatherTelegramBot.buildAlertLevelKeyboard(updated.alertPolicy)
                });
            }

            // 3. Actions (Status, Defesa Civil, INMET, Help, ChatID)
            if (data === 'action:status') {
                await answer('🔍 Verificando status...');
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
                    '📖 AJUDA E OPERAÇÃO DO BOT',
                    '',
                    '• Status & Varredura: Consulta rápida das configurações ativas e métricas.',
                    '• Jacuí & Telemetria: Monitoramento ao vivo do Rio Baixo Jacuí e chuva pela Defesa Civil RS.',
                    '• Avisos INMET: Consulta em tempo real de alertas de perigo na região.',
                    '• Configurações: Altere raio, intervalo e política de alerta em tempo real.'
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

        // Unrecognized Text Messages
        this.telegram.onText(ctx => {
            if (!this.isAdmin(ctx)) return this.replyUnauthorized(ctx);
            return ctx.reply('Use os botões do menu interativo ou digite /help para ver os comandos.', {
                reply_markup: WeatherTelegramBot.buildMainMenuKeyboard()
            });
        });

        // Global Error Handler
        this.telegram.onError(errorInfo => {
            this.logger.error?.('Telegram bot update failed:', errorInfo.error || errorInfo);
        });
    }
}

// =============================================================================
// BACKWARD-COMPATIBLE FUNCTIONAL EXPORTS
// =============================================================================

/**
 * Creates and registers the weather Telegram bot handlers.
 *
 * @param {object} options
 * @returns {import('./telegram.js').TelegramBotClient}
 */
export function createWeatherTelegramBot(options) {
    const bot = new WeatherTelegramBot(options);
    return bot.telegram;
}

/**
 * Formats detected high-risk events as plain Telegram text.
 *
 * @param {Array<object>} events
 * @param {Date} [sentAt]
 * @returns {string}
 */
export function formatHighRiskAlert(events, sentAt) {
    return WeatherTelegramBot.formatHighRiskAlert(events, sentAt);
}

/**
 * Sends a formatted high-risk alert to administrators.
 *
 * @param {import('./telegram.js').TelegramBotClient} telegram
 * @param {Array<object>} events
 * @param {Date} [sentAt]
 * @returns {Promise<object>}
 */
export function sendHighRiskAlerts(telegram, events, sentAt) {
    return telegram.sendToAdmins(WeatherTelegramBot.formatHighRiskAlert(events, sentAt));
}

/**
 * Builds the short status response.
 *
 * @returns {string}
 */
export function defaultStatusMessage() {
    const { radiusKm, intervalMinutes } = parseMonitorConfig();
    return [
        '✅ Monitor meteorológico ativo.',
        `Raio regional: ${radiusKm} km.`,
        `Intervalo: ${intervalMinutes} min.`,
        'Alertas de alto risco: habilitados para este chat.'
    ].join('\n');
}

/**
 * Creates the monitor alert callback.
 *
 * @param {object} options
 * @returns {(events: Array<object>) => Promise<object>}
 */
export function createTelegramAlertCallback({ telegram, logger = console }) {
    const bot = new WeatherTelegramBot({ telegram, logger });
    return bot.createAlertCallback();
}

export const buildMainMenuKeyboard = WeatherTelegramBot.buildMainMenuKeyboard;
export const buildSettingsKeyboard = WeatherTelegramBot.buildSettingsKeyboard;
export const buildIntervalKeyboard = WeatherTelegramBot.buildIntervalKeyboard;
export const buildRadiusKeyboard = WeatherTelegramBot.buildRadiusKeyboard;
export const buildAlertLevelKeyboard = WeatherTelegramBot.buildAlertLevelKeyboard;
export const renderMainMenu = (config) => {
    const bot = new WeatherTelegramBot({ telegram: { isAdminChat: () => true, onCommand() {}, onCallbackQuery() {}, onText() {}, onError() {} } });
    if (config) bot.localState = { ...bot.localState, ...config };
    return bot.renderMainMenu();
};
export const renderSettingsMenu = (config) => {
    const bot = new WeatherTelegramBot({ telegram: { isAdminChat: () => true, onCommand() {}, onCallbackQuery() {}, onText() {}, onError() {} } });
    if (config) bot.localState = { ...bot.localState, ...config };
    return bot.renderSettingsMenu();
};
export const renderDefesaCivilTelemetryReport = () => {
    const bot = new WeatherTelegramBot({ telegram: { isAdminChat: () => true, onCommand() {}, onCallbackQuery() {}, onText() {}, onError() {} } });
    return bot.renderDefesaCivilTelemetryReport();
};
export const renderInmetWarningsReport = (radiusKm) => {
    const bot = new WeatherTelegramBot({ telegram: { isAdminChat: () => true, onCommand() {}, onCallbackQuery() {}, onText() {}, onError() {} } });
    return bot.renderInmetWarningsReport(radiusKm);
};
