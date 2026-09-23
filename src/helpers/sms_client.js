/**
 * SMS Dev Gateway Client for Weather Alert Dispatch.
 * Thin wrapper over the SMS Dev HTTP API (`https://api.smsdev.com.br/v1`):
 * one JSON POST carries every recipient of a batch, so a subscriber list is a
 * single request. Mirrors `src/helpers/email_client.js` — a validated env
 * contract up front, an injectable service for tests, and a lazy singleton so
 * importing this module never demands deployment-only secrets.
 *
 * Billing follows the documented rule: each message is 160 characters and
 * costs 1 credit per 160 characters, per recipient.
 *
 * @module smsClient
 */

/** Official SMS Dev API base URL. */
export const DEFAULT_SMSDEV_BASE_URL = 'https://api.smsdev.com.br/v1';

/** Characters billed as one SMS segment (SMS Dev pricing). */
export const SMS_SEGMENT_LENGTH = 160;

/** Fixed service type required by the gateway: 9 = SMS. */
export const SMS_SERVICE_TYPE = 9;

/** Longest authentication key accepted by SMS Dev (documented limit). */
export const SMS_KEY_MAX_LENGTH = 128;

/**
 * Error raised when the SMS configuration cannot be used safely.
 */
export class SmsConfigurationError extends Error {
    /**
     * @param {string} message - Human-readable cause.
     */
    constructor(message) {
        super(message);
        this.name = 'SmsConfigurationError';
    }
}

/**
 * Reads and validates the environment contract for SMS delivery.
 * The key is mandatory in production and optional in development, which is
 * what makes `SMS_TESTING=true` a usable no-credentials local mode.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment values.
 * @returns {{ testing: boolean, key: string|undefined, baseUrl: string }} Validated SMS configuration.
 * @throws {SmsConfigurationError} When the configuration is unsafe or incomplete.
 */
export function getSmsConfig(env = process.env) {
    const testing = env.SMS_TESTING === 'true';
    const production = env.NODE_ENV === 'production';
    if (production && testing) {
        throw new SmsConfigurationError('SMS_TESTING cannot be enabled in production.');
    }

    const key = String(env.SMSDEV_KEY || '').trim();
    if (key.length > SMS_KEY_MAX_LENGTH) {
        throw new SmsConfigurationError(`SMSDEV_KEY must be at most ${SMS_KEY_MAX_LENGTH} characters.`);
    }
    if (production && !key) {
        throw new SmsConfigurationError('SMSDEV_KEY is required in production.');
    }

    const baseUrl = String(env.SMSDEV_BASE_URL || '').trim() || DEFAULT_SMSDEV_BASE_URL;
    if (!/^https:\/\//i.test(baseUrl)) {
        throw new SmsConfigurationError('SMSDEV_BASE_URL must be an https:// URL.');
    }

    return {
        testing,
        key: key || undefined,
        baseUrl: baseUrl.replace(/\/+$/, '')
    };
}

/**
 * Normalizes any accepted Brazilian spelling of a number to E.164 with country
 * code: `43999998888`, `(43) 99999-8888`, `5543999998888` and `+55 43 ...`
 * all collapse to `5543999998888`. DDD must be a real Brazilian code (11-99)
 * and subscriber digits must not start with 0.
 *
 * @param {unknown} value - Candidate phone number.
 * @returns {string} Normalized number starting with 55.
 * @throws {TypeError} When the value is empty or not a plausible Brazilian number.
 */
export function normalizeSmsNumber(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) {
        throw new TypeError('phone must contain digits.');
    }

    let national;
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        national = digits.slice(2);
    } else if (digits.length === 10 || digits.length === 11) {
        national = digits;
    } else {
        throw new TypeError('phone is not a plausible Brazilian number.');
    }

    const ddd = Number(national.slice(0, 2));
    const subscriber = national.slice(2);
    const validSubscriberLength = subscriber.length === 8 || subscriber.length === 9;
    if (ddd < 11 || ddd > 99 || !validSubscriberLength || subscriber.startsWith('0')) {
        throw new TypeError('phone is not a plausible Brazilian number.');
    }

    return `55${national}`;
}

/**
 * Counts paid segments for a message body, measuring Unicode code points so
 * accented Portuguese characters are not double-counted.
 *
 * @param {unknown} text - Message body.
 * @returns {number} Segment count, never below 1.
 */
export function countSmsSegments(text) {
    const length = Array.from(String(text ?? '')).length;
    return Math.max(1, Math.ceil(length / SMS_SEGMENT_LENGTH));
}

/**
 * Injectable SMS service. Production code uses the exported singleton; tests
 * inject a fake `fetchImpl` (or rely on `SMS_TESTING`) without any network IO.
 */
export class SmsService {
    #config;
    #fetchImpl;

    /**
     * @param {object} [options] - Dependencies and environment.
     * @param {NodeJS.ProcessEnv} [options.env=process.env] - Environment values.
     * @param {Function} [options.fetchImpl=null] - Fetch-compatible transport (defaults to globalThis.fetch at call time).
     */
    constructor({ env = process.env, fetchImpl = null } = {}) {
        this.#config = getSmsConfig(env);
        this.#fetchImpl = fetchImpl;
    }

    /**
     * Validated configuration for this service instance.
     *
     * @returns {{ testing: boolean, key: string|undefined, baseUrl: string }} Active configuration.
     */
    get config() {
        return this.#config;
    }

    /**
     * Resolves the transport, preferring an injected fake so tests stay offline.
     *
     * @returns {Function} Fetch-compatible function.
     */
    #transport() {
        return this.#fetchImpl || globalThis.fetch;
    }

    /**
     * Sends one SMS body to every recipient in a single gateway request.
     * Numbers are normalized first, so callers may pass any accepted format.
     *
     * @param {object} request - Dispatch request.
     * @param {string[]|string} request.numbers - Recipient list (any accepted Brazilian format).
     * @param {string} request.body - Message text.
     * @returns {Promise<{ testing?: true, recipients: number, segments: number, credits: number, accepted: number, failed: number, results: Array<object> }>} Per-recipient gateway outcome.
     * @throws {TypeError} When the recipient list or body is empty, or a number is malformed.
     * @throws {SmsConfigurationError} When no key is available outside testing mode.
     */
    async send({ numbers, body } = {}) {
        const list = Array.isArray(numbers) ? numbers : [numbers];
        if (list.length === 0) {
            throw new TypeError('At least one recipient is required.');
        }
        const normalized = list.map(number => normalizeSmsNumber(number));

        const text = String(body ?? '').trim();
        if (!text) {
            throw new TypeError('SMS body is required.');
        }

        const recipients = normalized.length;
        const segments = countSmsSegments(text);
        const credits = segments * recipients;

        if (this.#config.testing) {
            return {
                testing: true,
                recipients,
                segments,
                credits,
                accepted: recipients,
                failed: 0,
                results: normalized.map((number, index) => ({
                    number,
                    id: `test-${index + 1}`,
                    situacao: 'OK',
                    codigo: '1',
                    descricao: 'MENSAGEM NA FILA (SIMULADA)'
                }))
            };
        }

        if (!this.#config.key) {
            throw new SmsConfigurationError('SMSDEV_KEY is required to send SMS outside testing mode.');
        }

        const response = await this.#transport()(`${this.#config.baseUrl}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(normalized.map(number => ({
                key: this.#config.key,
                type: SMS_SERVICE_TYPE,
                number,
                msg: text
            })))
        });

        if (!response || response.ok === false) {
            throw new Error(`SMS Dev request failed with status ${response?.status ?? 'unknown'}.`);
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new TypeError('SMS Dev returned a non-JSON response.');
        }

        // The gateway answers an array for batches and a single object for some errors.
        const rawResults = Array.isArray(payload) ? payload : [payload];
        const results = rawResults.map(entry => ({
            number: entry?.number !== undefined && entry?.number !== null ? String(entry.number) : undefined,
            id: entry?.id !== undefined && entry?.id !== null ? String(entry.id) : undefined,
            situacao: String(entry?.situacao ?? ''),
            codigo: entry?.codigo !== undefined && entry?.codigo !== null ? String(entry.codigo) : undefined,
            descricao: String(entry?.descricao ?? '')
        }));

        const accepted = results.filter(entry => entry.situacao.toUpperCase() === 'OK').length;
        // A recipient omitted from the response never entered the queue, so it counts as failed.
        const failed = results.filter(entry => entry.situacao.toUpperCase() !== 'OK').length
            + Math.max(0, recipients - results.length);

        return { recipients, segments, credits, accepted, failed, results };
    }
}

let defaultSmsService;

/**
 * Default process-wide service. Construction is lazy so importing modules
 * does not require deployment-only SMS variables.
 *
 * @returns {SmsService} Shared SMS service.
 * @throws {SmsConfigurationError} When the environment cannot produce a valid configuration.
 */
export function getSmsService() {
    defaultSmsService ||= new SmsService();
    return defaultSmsService;
}
