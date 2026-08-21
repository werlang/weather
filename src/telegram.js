import { Bot } from 'grammy';

/** Telegram's documented maximum text-message size. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Parses a comma-separated Telegram chat allowlist.
 *
 * @param {string|undefined|null} value - Raw environment value.
 * @returns {string[]} Unique chat IDs in their string representation.
 * @throws {Error} If a configured chat ID is not an integer.
 */
export function parseTelegramAdminChatIds(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return [];
    }

    const chatIds = String(value)
        .split(',')
        .map(chatId => chatId.trim())
        .filter(Boolean);

    const invalidChatId = chatIds.find(chatId => !/^-?\d+$/.test(chatId));
    if (invalidChatId) {
        throw new Error(`Invalid Telegram administrator chat ID: ${invalidChatId}`);
    }

    return [...new Set(chatIds)];
}

/**
 * Reads and optionally validates Telegram settings from an environment object.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env=process.env] - Source configuration.
 * @param {boolean} [options.requireConfigured=true] - Whether missing settings
 *   should be rejected.
 * @returns {{ token: string, adminChatIds: string[] }} Telegram settings.
 * @throws {Error} When required settings are missing or malformed.
 */
export function parseTelegramConfig({ env = process.env, requireConfigured = true } = {}) {
    const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
    const adminChatIds = parseTelegramAdminChatIds(env.TELEGRAM_ADMIN_CHAT_ID);

    if (requireConfigured) {
        const missing = [];
        if (!token) missing.push('TELEGRAM_BOT_TOKEN');
        if (adminChatIds.length === 0) missing.push('TELEGRAM_ADMIN_CHAT_ID');
        if (missing.length > 0) {
            throw new Error(`Missing required Telegram configuration: ${missing.join(', ')}`);
        }
    }

    return { token, adminChatIds };
}

/**
 * Splits a message into chunks accepted by Telegram while preserving order.
 *
 * @param {string} message - Message text to split.
 * @param {number} [maxLength=TELEGRAM_MAX_MESSAGE_LENGTH] - Maximum chunk size.
 * @returns {string[]} Ordered message chunks.
 */
export function splitTelegramMessage(message, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH) {
    const characters = Array.from(String(message ?? ''));
    if (characters.length <= maxLength) return [characters.join('')];

    const chunks = [];
    for (let offset = 0; offset < characters.length; offset += maxLength) {
        chunks.push(characters.slice(offset, offset + maxLength).join(''));
    }
    return chunks;
}

/**
 * Thin project-owned wrapper around grammY's Bot instance.
 *
 * The application depends on this class instead of importing grammY in each
 * feature module. It also centralizes the administrator allowlist and keeps
 * outbound alert delivery independent from Telegram handler registration.
 */
export class TelegramBotClient {
    /**
     * @param {object} options
     * @param {string} options.token - BotFather token.
     * @param {string[]} options.adminChatIds - Authorized chat IDs.
     * @param {(token: string) => object} [options.botFactory] - Test seam for
     *   constructing a grammY-compatible bot.
     * @param {Console} [options.logger=console] - Logger for delivery failures.
     */
    constructor({ token, adminChatIds, botFactory = botToken => new Bot(botToken), logger = console }) {
        if (!String(token || '').trim()) {
            throw new Error('Telegram bot token is required.');
        }
        if (!Array.isArray(adminChatIds) || adminChatIds.length === 0) {
            throw new Error('At least one Telegram administrator chat ID is required.');
        }

        this.bot = botFactory(token);
        this.adminChatIds = [...new Set(adminChatIds.map(chatId => String(chatId)))];
        this.logger = logger;
    }

    /**
     * Tests whether a chat is in the configured administrator allowlist.
     *
     * @param {number|string|undefined|null} chatId - Telegram chat ID.
     * @returns {boolean} Whether the chat is authorized.
     */
    isAdminChat(chatId) {
        return chatId !== undefined && chatId !== null &&
            this.adminChatIds.includes(String(chatId));
    }

    /**
     * Registers a command handler on the wrapped bot.
     *
     * @param {string} command - Command name without the leading slash.
     * @param {Function} handler - grammY context handler.
     * @returns {TelegramBotClient} This client for composition.
     */
    onCommand(command, handler) {
        this.bot.command(command, handler);
        return this;
    }

    /**
     * Registers a text-message handler on the wrapped bot.
     *
     * @param {Function} handler - grammY context handler.
     * @returns {TelegramBotClient} This client for composition.
     */
    onText(handler) {
        this.bot.on('message:text', handler);
        return this;
    }

    /**
     * Registers the global grammY error handler.
     *
     * @param {Function} handler - Error handler receiving grammY's error info.
     * @returns {TelegramBotClient} This client for composition.
     */
    onError(handler) {
        this.bot.catch(handler);
        return this;
    }

    /**
     * Sends a message to every configured administrator.
     *
     * Each administrator is attempted independently, so one invalid or
     * unreachable chat does not prevent the remaining administrators from
     * receiving the alert.
     *
     * @param {string} message - Message text.
     * @param {object} [options] - Telegram sendMessage options.
     * @returns {Promise<{sent: Array<{chatId: string, chunks: number}>, failed: Array<{chatId: string, error: Error}>}>}
     *   Delivery summary.
     */
    async sendToAdmins(message, options = {}) {
        const chunks = splitTelegramMessage(message);
        const sent = [];
        const failed = [];

        for (const chatId of this.adminChatIds) {
            try {
                for (const chunk of chunks) {
                    await this.bot.api.sendMessage(chatId, chunk, options);
                }
                sent.push({ chatId, chunks: chunks.length });
            } catch (error) {
                failed.push({ chatId, error });
                this.logger.error?.(`Telegram delivery failed for chat ${chatId}:`, error);
            }
        }

        return { sent, failed };
    }

    /**
     * Starts grammY long polling and resolves when polling stops.
     *
     * @param {object} [options] - grammY `bot.start` options.
     * @returns {Promise<void>} Completion promise from grammY.
     */
    start(options = {}) {
        return this.bot.start(options);
    }

    /**
     * Stops grammY polling.
     *
     * @param {string} [reason] - Shutdown reason for grammY diagnostics.
     * @returns {void} Nothing.
     */
    stop(reason) {
        this.bot.stop(reason);
    }
}
