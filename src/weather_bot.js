#!/usr/bin/env node

import {
    parseTelegramConfig,
    TelegramBotClient
} from './telegram.js';
import {
    createTelegramAlertCallback,
    createWeatherTelegramBot
} from './telegram_bot.js';
import { startMonitoringService } from './monitor_service.js';

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

    createWeatherTelegramBot({ telegram: telegramClient, logger });

    const monitor = startMonitoringService({
        alertCallback: createTelegramAlertCallback({ telegram: telegramClient, logger }),
        registerSignalHandlers: false
    });

    const stop = signal => {
        monitor.stop();
        telegramClient.stop(signal);
    };

    const handleSignal = signal => stop(signal);
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    try {
        await telegramClient.start({
            onStart: botInfo => logger.log?.(`Telegram bot @${botInfo.username} started.`)
        });
    } finally {
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
        monitor.stop();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startWeatherBot().catch(error => {
        console.error(`❌ Unable to start Telegram weather bot: ${error.message}`);
        process.exitCode = 1;
    });
}
