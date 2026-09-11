/**
 * SMTP Email Client for Weather Alert Comunicados.
 * Inspired by node-aec `api/helpers/email.js`: explicit sender identity,
 * all-or-nothing SMTP credentials, header-injection guards, MJML strict
 * compilation, and Ethereal (`EMAIL_TESTING=true`) development delivery
 * with a browser-openable preview URL.
 *
 * @module emailClient
 */

import nodemailer from 'nodemailer';
import { convert as htmlToText } from 'html-to-text';
import mjml2html from 'mjml';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_NEWLINE_PATTERN = /[\r\n]/;

/**
 * Error raised when the mail transport cannot be used safely.
 */
export class EmailConfigurationError extends Error {
    /**
     * @param {string} message - Human-readable cause.
     */
    constructor(message) {
        super(message);
        this.name = 'EmailConfigurationError';
    }
}

/**
 * Reads and validates the environment contract for mail delivery.
 * Sender identity is always explicit; SMTP credentials are all-or-nothing.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment values.
 * @returns {{ testing: boolean, host: string|undefined, port: number, secure: boolean, user: string|undefined, password: string|undefined, fromName: string, fromEmail: string }} Validated mail configuration.
 * @throws {EmailConfigurationError} When the configuration is unsafe or incomplete.
 */
export function getEmailConfig(env = process.env) {
    const testing = env.EMAIL_TESTING === 'true';
    const production = env.NODE_ENV === 'production';
    if (production && testing) {
        throw new EmailConfigurationError('EMAIL_TESTING cannot be enabled in production.');
    }

    const fromName = String(env.SMTP_FROM_NAME || '').trim();
    const fromEmail = String(env.SMTP_FROM_EMAIL || '').trim();
    if (!fromName || !fromEmail || !EMAIL_PATTERN.test(fromEmail) || HEADER_NEWLINE_PATTERN.test(fromName) || HEADER_NEWLINE_PATTERN.test(fromEmail)) {
        throw new EmailConfigurationError('SMTP_FROM_NAME and SMTP_FROM_EMAIL must be valid sender values.');
    }

    const user = String(env.SMTP_USER || '').trim();
    const password = String(env.SMTP_PASSWORD || '').trim();
    if ((user && !password) || (!user && password)) {
        throw new EmailConfigurationError('SMTP_USER and SMTP_PASSWORD must be provided together.');
    }

    const host = String(env.SMTP_HOST || '').trim();
    if (production && !host) {
        throw new EmailConfigurationError('SMTP_HOST is required in production.');
    }

    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new EmailConfigurationError('SMTP_PORT must be a valid TCP port.');
    }

    const secure = env.SMTP_SECURE === 'true' || env.SMTP_SECURE === true;
    return {
        testing,
        host: host || undefined,
        port,
        secure,
        user: user || undefined,
        password: password || undefined,
        fromName,
        fromEmail
    };
}

/**
 * Resolves the alert comunicado recipient.
 * Falls back to a placeholder address when `ALERT_EMAIL_TO` is unset or
 * invalid, so the admin button always has a target in development.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment values.
 * @returns {string} Recipient email address.
 */
export function getAlertEmailRecipient(env = process.env) {
    const raw = String(env.ALERT_EMAIL_TO || '').trim();
    if (raw && EMAIL_PATTERN.test(raw) && !HEADER_NEWLINE_PATTERN.test(raw)) return raw;
    return 'comunicados-charqueadas@exemplo.edu.br';
}

/**
 * Guards a header value against injection and emptiness.
 *
 * @param {unknown} value - Candidate header value.
 * @param {string} field - Field name used in error messages.
 * @throws {TypeError} When the value is empty or contains CR/LF.
 */
function assertHeaderValue(value, field) {
    if (typeof value !== 'string' || !value.trim() || HEADER_NEWLINE_PATTERN.test(value)) {
        throw new TypeError(`${field} must be a non-empty header-safe string.`);
    }
}

/**
 * Normalizes the single alert recipient address.
 *
 * @param {unknown} value - Candidate recipient.
 * @returns {string} Validated address.
 * @throws {TypeError} When the address is missing or malformed.
 */
function normalizeRecipient(value) {
    const address = String(value || '').trim();
    assertHeaderValue(address, 'to address');
    if (!EMAIL_PATTERN.test(address)) {
        throw new TypeError('to contains an invalid recipient.');
    }
    return address;
}

/**
 * Injectable mail service. Production code uses the exported singleton, while
 * tests inject fake Nodemailer and MJML dependencies without network IO.
 */
export class EmailService {
    #config;
    #nodemailer;
    #mjmlRenderer;
    #htmlToText;
    #transporter;
    #testAccount;

    /**
     * @param {object} [options] - Dependencies and environment.
     * @param {NodeJS.ProcessEnv} [options.env=process.env] - Environment values.
     * @param {object} [options.nodemailerModule] - Nodemailer-compatible module.
     * @param {Function} [options.mjmlRenderer] - MJML-to-HTML compiler.
     * @param {Function} [options.htmlToTextConverter] - HTML-to-text converter.
     */
    constructor({ env = process.env, nodemailerModule = nodemailer, mjmlRenderer = mjml2html, htmlToTextConverter = htmlToText } = {}) {
        this.#config = getEmailConfig(env);
        this.#nodemailer = nodemailerModule;
        this.#mjmlRenderer = mjmlRenderer;
        this.#htmlToText = htmlToTextConverter;
    }

    /**
     * Lazily creates the configured SMTP or Ethereal transport.
     *
     * @returns {Promise<object>} Nodemailer transporter.
     */
    async #getTransporter() {
        if (this.#transporter) return this.#transporter;

        if (this.#config.testing) {
            this.#testAccount = await this.#nodemailer.createTestAccount();
            this.#transporter = this.#nodemailer.createTransport({
                host: this.#testAccount.smtp.host,
                port: this.#testAccount.smtp.port,
                secure: this.#testAccount.smtp.secure,
                auth: {
                    user: this.#testAccount.user,
                    pass: this.#testAccount.pass
                }
            });
            return this.#transporter;
        }

        const transport = {
            host: this.#config.host,
            port: this.#config.port,
            secure: this.#config.secure
        };
        if (this.#config.user && this.#config.password) {
            transport.auth = { user: this.#config.user, pass: this.#config.password };
        }
        this.#transporter = this.#nodemailer.createTransport(transport);
        return this.#transporter;
    }

    /**
     * Compiles MJML strictly, rejecting validation errors and leftover placeholders.
     *
     * @param {string} mjml - MJML source.
     * @returns {string} Compiled HTML.
     * @throws {TypeError} When compilation fails or placeholders remain.
     */
    #compile(mjml) {
        const result = this.#mjmlRenderer(mjml, { validationLevel: 'strict' });
        if (result.errors?.length) {
            throw new TypeError(`MJML validation failed: ${result.errors.map(error => error.message).join('; ')}`);
        }
        if (!result.html || /\{\{[^}]+\}\}/.test(result.html)) {
            throw new TypeError('Compiled email HTML contains unresolved placeholders.');
        }
        return result.html;
    }

    /**
     * Sends one alert message after validating headers, recipient, and content.
     *
     * @param {object} [message] - Message fields.
     * @param {string} message.to - Recipient address.
     * @param {string} message.subject - Single-line subject.
     * @param {string} [message.mjml] - MJML source (compiled strictly).
     * @param {string} [message.html] - Pre-compiled HTML alternative.
     * @param {string} [message.text] - Plain-text alternative (auto-derived when omitted).
     * @returns {Promise<{ messageId: string|undefined, previewUrl: string|undefined }>} Provider result without message contents.
     * @throws {TypeError} When headers, recipient, or content are invalid.
     */
    async send({ to, subject, mjml, html, text } = {}) {
        const normalizedTo = normalizeRecipient(to);
        assertHeaderValue(subject, 'subject');

        let compiledHtml = html;
        if (mjml !== undefined) {
            compiledHtml = this.#compile(mjml);
        }
        if (typeof compiledHtml !== 'string' || !compiledHtml.trim()) {
            throw new TypeError('HTML or MJML content is required.');
        }
        if (/\{\{[^}]+\}\}/.test(compiledHtml)) {
            throw new TypeError('Email HTML contains unresolved placeholders.');
        }

        const plainText = typeof text === 'string' && text.trim()
            ? text
            : this.#htmlToText(compiledHtml, { wordwrap: 78 }).trim();
        if (!plainText) throw new TypeError('Plain-text email content is required.');

        const transporter = await this.#getTransporter();
        const result = await transporter.sendMail({
            from: { name: this.#config.fromName, address: this.#config.fromEmail },
            to: normalizedTo,
            subject,
            html: compiledHtml,
            text: plainText
        });

        const previewUrl = this.#config.testing && typeof this.#nodemailer.getTestMessageUrl === 'function'
            ? this.#nodemailer.getTestMessageUrl(result)
            : undefined;
        return {
            messageId: result?.messageId,
            ...(previewUrl ? { previewUrl } : {})
        };
    }

    /**
     * Verifies the underlying transport.
     *
     * @returns {Promise<boolean>} Whether verification completed.
     */
    async verify() {
        const transporter = await this.#getTransporter();
        if (typeof transporter.verify === 'function') {
            await transporter.verify();
        }
        return true;
    }

    /**
     * Closes the underlying transport when it was created.
     *
     * @returns {Promise<void>} Nothing.
     */
    async close() {
        if (this.#transporter && typeof this.#transporter.close === 'function') {
            this.#transporter.close();
        }
        this.#transporter = undefined;
    }
}

let defaultEmailService;

/**
 * Default process-wide service. Construction is lazy so importing modules
 * does not require deployment-only mail variables.
 *
 * @returns {EmailService} Shared email service.
 */
export function getEmailService() {
    defaultEmailService ||= new EmailService();
    return defaultEmailService;
}
