#!/usr/bin/env node

import {
    parseTelegramConfig,
    TelegramBotClient
} from './bot/telegram.js';
import { WeatherTelegramBot } from './bot/telegram_bot.js';
import { startMonitoringService } from './monitoring/monitor_service.js';
import { getPersistedAdminChatIds } from './model/admin_store.js';
import { createDevNotifier } from './helpers/dev_notifier.js';

/**
 * Starts the canonical weather monitor and its Telegram interface.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env=process.env] - Runtime configuration.
 * @param {Console} [options.logger=console] - Application logger.
 * @param {TelegramBotClient} [options.telegram] - Injected client for tests.
 * @returns {Promise<void>} Resolves when the bot stops.
 */
export async function startWeatherBot({ env = process.env, logger = console, telegram } = {}) {
    const config = parseTelegramConfig({ env });
    const telegramClient = telegram || new TelegramBotClient({
        token: config.token,
        adminChatIds: config.adminChatIds,
        logger
    });

    // Developer notifications are a separate, optional DM channel. They never
    // reuse the administrator allowlist or the alert delivery path.
    const devChatId = String(env.DEV_TELEGRAM_CHAT_ID || '').trim();
    const rawDevCooldown = String(env.DEV_NOTIFY_COOLDOWN_MINUTES ?? '').trim();
    const devCooldownMinutes = rawDevCooldown === '' ? Number.NaN : Number(rawDevCooldown);
    const devNotifier = createDevNotifier({
        chatId: /^-?\d+$/.test(devChatId) ? devChatId : null,
        cooldownMs: Number.isFinite(devCooldownMinutes) && devCooldownMinutes >= 0
            ? devCooldownMinutes * 60 * 1000
            : undefined,
        sendMessage: async (chatId, message) => {
            const result = await telegramClient.sendMessage(chatId, message);
            if (result?.error) throw result.error;
        },
        logger
    });

    if (devChatId && !devNotifier.enabled) {
        logger.warn?.('DEV_TELEGRAM_CHAT_ID is invalid; developer notifications are disabled.');
    } else if (devNotifier.enabled) {
        logger.log?.('Developer error notifications enabled.');
    }

    // Merge persisted invite-promoted admins (admin_users table)
    try {
        const persisted = getPersistedAdminChatIds();
        for (const chatId of persisted) {
            telegramClient.addAdminChatId(chatId);
        }
        if (persisted.length) logger.log?.(`Loaded ${persisted.length} persisted admin(s) from database.`);
    } catch {}

    const bot = new WeatherTelegramBot({
        telegram: telegramClient,
        logger,
        onOperationalError: devNotifier.notify
    });

    const monitor = startMonitoringService({
        alertCallback: bot.createAlertCallback(),
        onOperationalError: devNotifier.notify,
        registerSignalHandlers: false
    });

    bot.setMonitorService(monitor);

    const stop = signal => {
        monitor.stop();
        telegramClient.stop(signal);
    };

    const handleSignal = signal => stop(signal);
    const handleUnhandledRejection = reason => {
        logger.error?.('Unhandled rejection:', reason);
        void devNotifier.notify({
            key: 'process-unhandled-rejection',
            component: 'process',
            title: 'Unhandled promise rejection',
            error: reason
        });
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
    process.on('unhandledRejection', handleUnhandledRejection);

    try {
        await telegramClient.start({
            onStart: async botInfo => {
                logger.log?.(`Telegram bot @${botInfo.username} started.`);
                await bot.initCommands().catch(() => {});
            }
        });
    } catch (error) {
        void devNotifier.notify({
            key: 'telegram-polling',
            component: 'telegram',
            title: 'Bot polling stopped',
            error
        });
        throw error;
    } finally {
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
        process.removeListener('unhandledRejection', handleUnhandledRejection);
        monitor.stop();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startWeatherBot().catch(error => {
        console.error(`❌ Unable to start Telegram weather bot: ${error.message}`);
        process.exitCode = 1;
    });
}
