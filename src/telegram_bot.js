import { onHighRiskEventDetected, parseMonitorConfig } from './monitor_service.js';

const HELP_MESSAGE = [
    'Comandos disponíveis:',
    '/start — apresenta o bot e informa o estado de autorização.',
    '/help — mostra esta ajuda.',
    '/chatid — informa o ID deste chat para configuração.',
    '/status — mostra o estado básico do monitor (somente administrador).'
].join('\n');

const UNAUTHORIZED_MESSAGE = [
    'Este bot está restrito ao administrador configurado.',
    'Use /chatid para consultar o ID deste chat e peça ao responsável pela configuração que o autorize.'
].join('\n');

/**
 * Formats detected high-risk events as plain Telegram text.
 *
 * Plain text is intentional: event fields originate in external API payloads,
 * so avoiding Telegram markup keeps the alert readable without an escaping
 * failure or accidental formatting.
 *
 * @param {Array<object>} events - High-risk events from the risk analyzer.
 * @param {Date} [sentAt=new Date()] - Timestamp shown in the alert header.
 * @returns {string} Formatted alert message.
 */
export function formatHighRiskAlert(events, sentAt = new Date()) {
    const lines = [
        '🚨 ALERTA METEOROLÓGICO DE ALTO RISCO',
        `Detectado em: ${sentAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        `Eventos: ${events.length}`,
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
 * Registers the weather bot commands and authorization middleware.
 *
 * @param {object} options
 * @param {import('./telegram.js').TelegramBotClient} options.telegram - Bot wrapper.
 * @param {() => string} [options.getStatus] - Status message provider.
 * @param {Console} [options.logger=console] - Logger for update failures.
 * @returns {import('./telegram.js').TelegramBotClient} Configured wrapper.
 */
export function createWeatherTelegramBot({ telegram, getStatus = defaultStatusMessage, logger = console }) {
    if (!telegram) throw new Error('A Telegram bot client is required.');

    const isAdmin = ctx => telegram.isAdminChat(ctx.chat?.id);
    const replyUnauthorized = ctx => ctx.reply(UNAUTHORIZED_MESSAGE);

    telegram.onCommand('start', ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        return ctx.reply('Bot de monitoramento meteorológico ativo. Use /help para ver os comandos.');
    });

    telegram.onCommand('help', ctx => ctx.reply(HELP_MESSAGE));

    telegram.onCommand('chatid', ctx => {
        const chatId = ctx.chat?.id;
        return ctx.reply(`ID deste chat: ${chatId ?? 'indisponível'}`);
    });

    telegram.onCommand('status', ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        return ctx.reply(getStatus());
    });

    telegram.onText(ctx => {
        if (!isAdmin(ctx)) return replyUnauthorized(ctx);
        return ctx.reply('Comando não reconhecido. Use /help.');
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
