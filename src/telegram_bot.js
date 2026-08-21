/**
 * Telegram Bot Presentation & Interactive UI Layer.
 * Provides interactive menus, inline button keyboards for on-demand actions,
 * and live settings adjustment (scan interval, regional radius, alert thresholds).
 * 
 * @module telegramBot
 */

import { InlineKeyboard } from './telegram.js';
import { onHighRiskEventDetected, parseMonitorConfig } from './monitor_service.js';
import { getDefesaCivilTelemetry, REGIONAL_STATIONS } from './defesa_civil_client.js';
import { getSurroundingCities, getRegionalRiskWarnings, getAlertEmoji } from './inmet_client.js';
import { getFetchStats } from './log_database.js';

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
 * Builds the primary inline keyboard for the bot main dashboard.
 *
 * @returns {InlineKeyboard}
 */
export function buildMainMenuKeyboard() {
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
export function buildSettingsKeyboard() {
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
 * @param {number} currentMinutes
 * @returns {InlineKeyboard}
 */
export function buildIntervalKeyboard(currentMinutes = 15) {
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
 * @param {number} currentRadius
 * @returns {InlineKeyboard}
 */
export function buildRadiusKeyboard(currentRadius = 50) {
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
 * @param {string} currentPolicy
 * @returns {InlineKeyboard}
 */
export function buildAlertLevelKeyboard(currentPolicy = 'school') {
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
 * Formats detected high-risk events as plain Telegram text.
 *
 * @param {Array<object>} events - High-risk events from the risk analyzer.
 * @param {Date} [sentAt=new Date()] - Timestamp shown in the alert header.
 * @returns {string} Formatted alert message.
 */
export function formatHighRiskAlert(events, sentAt = new Date()) {
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
 * Sends a formatted high-risk alert through the project Telegram wrapper.
 *
 * @param {import('./telegram.js').TelegramBotClient} telegram - Bot wrapper.
 * @param {Array<object>} events - High-risk events to deliver.
 * @param {Date} [sentAt] - Optional timestamp for deterministic tests.
 * @returns {Promise<object>} Delivery summary from the wrapper.
 */
export function sendHighRiskAlerts(telegram, events, sentAt) {
    return telegram.sendToAdmins(formatHighRiskAlert(events, sentAt));
}

/**
 * Renders the main dashboard text.
 * 
 * @param {object} config
 * @returns {string}
 */
export function renderMainMenu(config) {
    const policyLabel = ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy;
    return [
        '🌤️ PAINEL METEOROLÓGICO — CHARQUEADAS / RS',
        'Monitoramento 24/7 de Riscos e Telemetria Hidrometeorológica',
        '',
        `📍 Município Central: Charqueadas - RS (IBGE 4305355)`,
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
 * @param {object} config
 * @returns {string}
 */
export function renderSettingsMenu(config) {
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
export async function renderDefesaCivilTelemetryReport() {
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
 * @param {number} radiusKm
 * @returns {Promise<string>}
 */
export async function renderInmetWarningsReport(radiusKm = 50) {
    try {
        const cities = await getSurroundingCities(radiusKm);
        const { regionalWarnings } = await getRegionalRiskWarnings(cities);

        const lines = [
            '⚡ AVISOS METEOROLÓGICOS OFICIAIS (INMET)',
            `Raio monitorado: ${radiusKm} km (${cities.length} municípios)`,
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
 * Registers the weather bot commands, interactive button menus, and authorization middleware.
 *
 * @param {object} options
 * @param {import('./telegram.js').TelegramBotClient} options.telegram - Bot wrapper.
 * @param {object} [options.monitorService] - Running monitor service for live config updates.
 * @param {() => string} [options.getStatus] - Status message provider.
 * @param {Console} [options.logger=console] - Logger for update failures.
 * @returns {import('./telegram.js').TelegramBotClient} Configured wrapper.
 */
export function createWeatherTelegramBot({
    telegram,
    monitorService = null,
    getStatus = null,
    logger = console
}) {
    if (!telegram) throw new Error('A Telegram bot client is required.');

    // Local mutable state fallback if monitorService is not passed
    const localState = {
        radiusKm: 50,
        intervalMinutes: 15,
        intervalMs: 15 * 60 * 1000,
        alertPolicy: 'school'
    };

    const getConfig = () => {
        if (monitorService?.getConfig) return monitorService.getConfig();
        const base = parseMonitorConfig();
        return {
            radiusKm: localState.radiusKm || base.radiusKm,
            intervalMinutes: localState.intervalMinutes || base.intervalMinutes,
            intervalMs: localState.intervalMs || base.intervalMs,
            alertPolicy: localState.alertPolicy || 'school'
        };
    };

    const updateConfig = update => {
        if (monitorService?.updateConfig) return monitorService.updateConfig(update);
        if (update.radiusKm) localState.radiusKm = update.radiusKm;
        if (update.intervalMinutes) {
            localState.intervalMinutes = update.intervalMinutes;
            localState.intervalMs = update.intervalMinutes * 60 * 1000;
        }
        if (update.policy) localState.alertPolicy = update.policy;
        return getConfig();
    };

    const isAdmin = ctx => telegram.isAdminChat(ctx.chat?.id);
    const replyUnauthorized = ctx => ctx.reply([
        '🔒 Este bot está restrito ao administrador configurado.',
        'Use /chatid para consultar o ID deste chat e peça ao responsável pela configuração que o autorize.'
    ].join('\n'));

    // Command: /start & /menu -> Show Main Dashboard with Interactive Buttons
    const handleStart = async ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        const config = getConfig();
        const text = renderMainMenu(config);
        return ctx.reply(text, { reply_markup: buildMainMenuKeyboard() });
    };

    telegram.onCommand('start', handleStart);
    telegram.onCommand('menu', handleStart);

    telegram.onCommand('help', ctx => {
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

    telegram.onCommand('chatid', ctx => {
        const chatId = ctx.chat?.id;
        return ctx.reply(`ID deste chat: ${chatId ?? 'indisponível'}`);
    });

    telegram.onCommand('status', async ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        const config = getConfig();
        let statusText = '';
        if (typeof getStatus === 'function') {
            statusText = getStatus();
        } else {
            let stats = null;
            try { stats = getFetchStats(); } catch {}
            statusText = [
                '✅ MONITOR METEOROLÓGICO OPERACIONAL',
                `• Raio Regional: ${config.radiusKm} km`,
                `• Intervalo de Varredura: A cada ${config.intervalMinutes} min`,
                `• Política de Alertas: ${ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy}`,
                stats ? `• Requisições Registradas (SQLite): ${stats.totalFetches} (${stats.successfulFetches} OK)` : '',
                stats ? `• Alertas Históricos no Banco: ${stats.totalAlertsRecorded}` : '',
                `• Ponto Central: Charqueadas - RS (IBGE 4305355)`
            ].filter(Boolean).join('\n');
        }

        return ctx.reply(statusText, { reply_markup: buildMainMenuKeyboard() });
    });

    telegram.onCommand('config', ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        const config = getConfig();
        return ctx.reply(renderSettingsMenu(config), { reply_markup: buildSettingsKeyboard() });
    });

    telegram.onCommand('jacui', async ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        const report = await renderDefesaCivilTelemetryReport();
        const kb = new InlineKeyboard()
            .text('🔄 Atualizar Telemetria', 'action:defesa_civil')
            .text('⬅️ Menu', 'menu:main');
        return ctx.reply(report, { reply_markup: kb });
    });

    telegram.onCommand('inmet', async ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        const config = getConfig();
        const report = await renderInmetWarningsReport(config.radiusKm);
        const kb = new InlineKeyboard()
            .text('🔄 Atualizar Avisos', 'action:inmet_warnings')
            .text('⬅️ Menu', 'menu:main');
        return ctx.reply(report, { reply_markup: kb });
    });

    // Callback Query Handler for Inline Buttons
    telegram.onCallbackQuery(async ctx => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery?.({ text: 'Acesso restrito.', show_alert: true });
            return replyUnauthorized(ctx);
        }

        const data = ctx.callbackQuery?.data || '';
        const answer = text => ctx.answerCallbackQuery?.(text ? { text } : undefined);
        const config = getConfig();

        // 1. Navigation Menus
        if (data === 'menu:main') {
            await answer();
            return ctx.editMessageText?.(renderMainMenu(config), { reply_markup: buildMainMenuKeyboard() });
        }

        if (data === 'menu:settings') {
            await answer();
            return ctx.editMessageText?.(renderSettingsMenu(config), { reply_markup: buildSettingsKeyboard() });
        }

        if (data === 'menu:interval') {
            await answer();
            const text = `⏱️ ESCOLHA O INTERVALO DE VARREDURA:\n(Intervalo atual: a cada ${config.intervalMinutes} min)`;
            return ctx.editMessageText?.(text, { reply_markup: buildIntervalKeyboard(config.intervalMinutes) });
        }

        if (data === 'menu:radius') {
            await answer();
            const text = `📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:\n(Raio atual: ${config.radiusKm} km)`;
            return ctx.editMessageText?.(text, { reply_markup: buildRadiusKeyboard(config.radiusKm) });
        }

        if (data === 'menu:alert_level') {
            await answer();
            const text = `🚨 ESCOLHA O NÍVEL DE SENSIBILIDADE DE ALERTA:\n(Nível atual: ${ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy})`;
            return ctx.editMessageText?.(text, { reply_markup: buildAlertLevelKeyboard(config.alertPolicy) });
        }

        // 2. Settings Modifiers (Interval, Radius, Alert Level)
        if (data.startsWith('set_interval:')) {
            const minutes = parseInt(data.split(':')[1], 10);
            const updated = updateConfig({ intervalMinutes: minutes });
            await answer(`✅ Intervalo atualizado para ${minutes} minutos!`);
            const text = `⏱️ ESCOLHA O INTERVALO DE VARREDURA:\n(Intervalo atual: a cada ${updated.intervalMinutes} min)`;
            return ctx.editMessageText?.(text, { reply_markup: buildIntervalKeyboard(updated.intervalMinutes) });
        }

        if (data.startsWith('set_radius:')) {
            const km = parseInt(data.split(':')[1], 10);
            const updated = updateConfig({ radiusKm: km });
            await answer(`✅ Raio regional atualizado para ${km} km!`);
            const text = `📍 ESCOLHA O RAIO REGIONAL DE COBERTURA:\n(Raio atual: ${updated.radiusKm} km)`;
            return ctx.editMessageText?.(text, { reply_markup: buildRadiusKeyboard(updated.radiusKm) });
        }

        if (data.startsWith('set_alert:')) {
            const policyKey = data.split(':')[1];
            const updated = updateConfig({ policy: policyKey });
            await answer(`✅ Política de alerta atualizada!`);
            const text = `🚨 ESCOLHA O NÍVEL DE SENSIBILIDADE DE ALERTA:\n(Nível atual: ${ALERT_POLICIES[updated.alertPolicy]?.label || updated.alertPolicy})`;
            return ctx.editMessageText?.(text, { reply_markup: buildAlertLevelKeyboard(updated.alertPolicy) });
        }

        // 3. Actions (Status, Defesa Civil, INMET, Help, ChatID)
        if (data === 'action:status') {
            await answer('🔍 Verificando status...');
            let statusText = '';
            if (typeof getStatus === 'function') {
                statusText = getStatus();
            } else {
                let stats = null;
                try { stats = getFetchStats(); } catch {}
                statusText = [
                    '✅ STATUS ATUAL DO MONITOR',
                    `• Raio: ${config.radiusKm} km`,
                    `• Intervalo: ${config.intervalMinutes} min`,
                    `• Alertas: ${ALERT_POLICIES[config.alertPolicy]?.label || config.alertPolicy}`,
                    stats ? `• Requisições SQLite: ${stats.totalFetches} (${stats.successfulFetches} OK)` : '',
                    stats ? `• Alertas Registrados: ${stats.totalAlertsRecorded}` : '',
                    `• Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
                ].filter(Boolean).join('\n');
            }
            return ctx.editMessageText?.(statusText, { reply_markup: buildMainMenuKeyboard() });
        }

        if (data === 'action:defesa_civil') {
            await answer('🌊 Carregando telemetria...');
            const report = await renderDefesaCivilTelemetryReport();
            const kb = new InlineKeyboard()
                .text('🔄 Atualizar', 'action:defesa_civil')
                .text('⬅️ Menu', 'menu:main');
            return ctx.editMessageText?.(report, { reply_markup: kb });
        }

        if (data === 'action:inmet_warnings') {
            await answer('⚡ Consultando INMET...');
            const report = await renderInmetWarningsReport(config.radiusKm);
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
            return ctx.editMessageText?.(text, { reply_markup: buildMainMenuKeyboard() });
        }

        if (data === 'action:chatid') {
            await answer();
            return ctx.editMessageText?.(`🆔 ID deste chat: ${ctx.chat?.id ?? 'indisponível'}`, {
                reply_markup: buildMainMenuKeyboard()
            });
        }
    });

    telegram.onText(ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        return ctx.reply('Use os botões do menu interativo ou digite /help para ver os comandos.', {
            reply_markup: buildMainMenuKeyboard()
        });
    });

    telegram.onError(errorInfo => {
        logger.error?.('Telegram bot update failed:', errorInfo.error || errorInfo);
    });

    return telegram;
}

/**
 * Builds the short status response used by the administrator command.
 *
 * @returns {string} Current configured monitor interval and radius.
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
 * Creates the monitor callback that logs and delivers detected events.
 *
 * @param {object} options
 * @param {import('./telegram.js').TelegramBotClient} options.telegram - Bot wrapper.
 * @param {Console} [options.logger=console] - Logger for the local alert log.
 * @returns {(events: Array<object>) => Promise<object>} Alert callback.
 */
export function createTelegramAlertCallback({ telegram, logger = console }) {
    return async events => {
        onHighRiskEventDetected(events);
        const delivery = await sendHighRiskAlerts(telegram, events);
        if (delivery.failed.length > 0) {
            logger.error?.(`Telegram alert delivery failed for ${delivery.failed.length} administrator chat(s).`);
        }
        return delivery;
    };
}
