/**
 * Developer-facing operational error notifier.
 *
 * Sends a plain Telegram direct message to one developer chat, deliberately
 * separate from the administrator alert fan-out: it does not use the admin
 * allowlist, the alert keyboard, or `alert_logs`. Identical errors are
 * rate-limited by key so a persistent upstream failure becomes a reminder
 * instead of one message per monitoring cycle.
 *
 * The transport is injected, so this module stays free of Telegram coupling
 * and can be unit tested without network I/O.
 *
 * @module devNotifier
 */

/** Default cooldown between two notifications for the same error key (6 hours). */
export const DEFAULT_DEV_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Conservative cap below Telegram's 4096-character message limit. */
export const DEV_NOTIFY_MAX_LENGTH = 3500;

/**
 * Extracts a readable message from an error-like value.
 *
 * @param {unknown} error - Thrown value, Error instance, or descriptive text.
 * @returns {string} Human-readable error text, or an empty string.
 */
function describeError(error) {
    if (error === undefined || error === null) return '';
    if (error instanceof Error) return String(error.message || error.name || '').trim();
    if (typeof error === 'string') return error.trim();
    if (typeof error === 'object' && 'message' in error) return String(error.message || '').trim();
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/**
 * Normalizes the optional details field into one line.
 *
 * @param {unknown} details - String, array of strings, or plain object.
 * @returns {string} One-line detail text, or an empty string.
 */
function describeDetails(details) {
    if (details === undefined || details === null) return '';
    if (Array.isArray(details)) {
        return details.map(item => String(item ?? '').trim()).filter(Boolean).join(' | ');
    }
    if (typeof details === 'object') {
        try {
            return JSON.stringify(details);
        } catch {
            return String(details);
        }
    }
    return String(details).trim();
}

/**
 * Formats one developer notification as a compact plain-text Telegram message.
 *
 * @param {object} [notification]
 * @param {string} [notification.component='weather'] - Subsystem that failed.
 * @param {string} [notification.key='unknown'] - Stable deduplication key.
 * @param {string} [notification.title='Erro operacional'] - Short human summary.
 * @param {unknown} [notification.error] - Error instance or message.
 * @param {unknown} [notification.details] - Extra context.
 * @param {Date} [notification.timestamp=new Date()] - Event time.
 * @returns {string} Message text capped at {@link DEV_NOTIFY_MAX_LENGTH} code points.
 */
export function formatDevNotification({
    component = 'weather',
    key = 'unknown',
    title = 'Erro operacional',
    error,
    details,
    timestamp = new Date()
} = {}) {
    const when = timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const lines = [
        `🛠️ [DEV] ${component} — ${title}`,
        `🕒 ${when} (BRT)`,
        `🔑 ${key}`
    ];

    const errorMessage = describeError(error);
    if (errorMessage) lines.push(`⚠️ ${errorMessage}`);

    const detailText = describeDetails(details);
    if (detailText) lines.push(`📋 ${detailText}`);

    return Array.from(lines.join('\n')).slice(0, DEV_NOTIFY_MAX_LENGTH).join('');
}

/**
 * Creates a developer notifier. When `chatId` or `sendMessage` is missing the
 * notifier is disabled and every call is a no-op.
 *
 * @param {object} options
 * @param {string|number|null} [options.chatId] - Developer Telegram chat ID.
 * @param {(chatId: string, message: string) => Promise<unknown>} [options.sendMessage] - Transport callback.
 * @param {number} [options.cooldownMs=DEFAULT_DEV_NOTIFY_COOLDOWN_MS] - Per-key cooldown.
 * @param {() => number} [options.now=Date.now] - Clock injection for tests.
 * @param {Console} [options.logger=console] - Logger for transport failures.
 * @returns {{ enabled: boolean, notify: (notification: object) => Promise<boolean> }}
 *   Notifier facade; `notify` resolves to whether a message was actually sent.
 */
export function createDevNotifier({
    chatId,
    sendMessage,
    cooldownMs = DEFAULT_DEV_NOTIFY_COOLDOWN_MS,
    now = () => Date.now(),
    logger = console
} = {}) {
    const target = chatId === undefined || chatId === null ? '' : String(chatId).trim();
    const enabled = Boolean(target && typeof sendMessage === 'function');
    const effectiveCooldownMs = Number.isFinite(cooldownMs) && cooldownMs >= 0
        ? cooldownMs
        : DEFAULT_DEV_NOTIFY_COOLDOWN_MS;
    const lastSentAt = new Map();

    /**
     * Sends one notification unless the same key is still cooling down.
     * Never throws: transport and formatting failures are logged and reported
     * as `false` so a monitoring cycle can never be broken by this channel.
     *
     * @param {object} [notification] - Same shape accepted by {@link formatDevNotification}.
     * @returns {Promise<boolean>} True only when the message was sent.
     */
    async function notify(notification = {}) {
        if (!enabled) return false;

        try {
            const key = String(notification.key || notification.component || 'unknown');
            const timestamp = now();
            const previous = lastSentAt.get(key);
            if (previous !== undefined && timestamp - previous < effectiveCooldownMs) {
                return false;
            }

            // Reserve the slot before awaiting the transport so concurrent
            // cycles cannot both send the same error.
            lastSentAt.set(key, timestamp);

            const message = formatDevNotification({
                ...notification,
                timestamp: new Date(timestamp)
            });

            try {
                await sendMessage(target, message);
                return true;
            } catch (error) {
                lastSentAt.delete(key);
                logger.error?.('[dev_notifier] failed to send developer notification:', error?.message || error);
                return false;
            }
        } catch (error) {
            logger.error?.('[dev_notifier] failed to build developer notification:', error?.message || error);
            return false;
        }
    }

    return { enabled, notify };
}
