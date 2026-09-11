import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    EmailConfigurationError,
    EmailService,
    getAlertEmailRecipient,
    getEmailConfig
} from '../../src/helpers/email_client.js';

const SENDER_ENV = {
    SMTP_FROM_NAME: 'Monitor Charqueadas',
    SMTP_FROM_EMAIL: 'monitor@charqueadas.exemplo.edu.br'
};

/**
 * Builds a fake nodemailer module capturing sent mail without network IO.
 *
 * @param {object} [options] - Fake behavior flags.
 * @returns {object} Fake nodemailer module with captured mail.
 */
function createFakeNodemailer({ testAccount = null, testMessageUrl = 'https://ethereal.email/message/fake-preview' } = {}) {
    const sent = [];
    const createdTransports = [];
    const state = { verified: false, closed: false };
    return {
        sent,
        createdTransports,
        state,
        async createTestAccount() {
            return testAccount || {
                smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
                user: 'ethereal-user',
                pass: 'ethereal-pass'
            };
        },
        createTransport(config) {
            createdTransports.push(config);
            return {
                config,
                async sendMail(message) {
                    sent.push(message);
                    return { messageId: '<fake-message-id>' };
                },
                async verify() {
                    state.verified = true;
                    return true;
                },
                close() {
                    state.closed = true;
                }
            };
        },
        getTestMessageUrl() {
            return testMessageUrl;
        }
    };
}

/**
 * Builds a fake MJML renderer.
 *
 * @param {object} [options] - Fake behavior flags.
 * @returns {Function} MJML-compatible renderer function.
 */
function createFakeMjml({ html = '<html><body>fake</body></html>', errors = [] } = {}) {
    const renderer = (mjml, options) => {
        renderer.calls.push({ mjml, options });
        return { html, errors };
    };
    renderer.calls = [];
    return renderer;
}

describe('Email configuration contract (node-aec inspired)', () => {
    it('accepts a minimal development sender-only configuration', () => {
        const config = getEmailConfig({ ...SENDER_ENV, EMAIL_TESTING: 'true' });
        assert.equal(config.testing, true);
        assert.equal(config.fromEmail, 'monitor@charqueadas.exemplo.edu.br');
        assert.equal(config.port, 587);
        assert.equal(config.host, undefined);
    });

    it('rejects Ethereal testing mode in production', () => {
        assert.throws(
            () => getEmailConfig({ ...SENDER_ENV, NODE_ENV: 'production', EMAIL_TESTING: 'true' }),
            EmailConfigurationError
        );
    });

    it('requires an explicit valid sender identity', () => {
        assert.throws(() => getEmailConfig({}), EmailConfigurationError);
        assert.throws(
            () => getEmailConfig({ SMTP_FROM_NAME: 'Monitor', SMTP_FROM_EMAIL: 'not-an-email' }),
            EmailConfigurationError
        );
        assert.throws(
            () => getEmailConfig({ SMTP_FROM_NAME: 'Bad\nName', SMTP_FROM_EMAIL: 'monitor@example.com' }),
            EmailConfigurationError
        );
    });

    it('requires SMTP credentials all-or-nothing', () => {
        assert.throws(
            () => getEmailConfig({ ...SENDER_ENV, SMTP_USER: 'user' }),
            EmailConfigurationError
        );
        assert.throws(
            () => getEmailConfig({ ...SENDER_ENV, SMTP_PASSWORD: 'pass' }),
            EmailConfigurationError
        );
    });

    it('requires an SMTP host in production and a valid port', () => {
        assert.throws(
            () => getEmailConfig({ ...SENDER_ENV, NODE_ENV: 'production' }),
            EmailConfigurationError
        );
        assert.throws(
            () => getEmailConfig({ ...SENDER_ENV, SMTP_PORT: 'not-a-port' }),
            EmailConfigurationError
        );
        const prod = getEmailConfig({
            ...SENDER_ENV,
            NODE_ENV: 'production',
            SMTP_HOST: 'smtp.example.com',
            SMTP_PORT: '465',
            SMTP_SECURE: 'true'
        });
        assert.equal(prod.host, 'smtp.example.com');
        assert.equal(prod.secure, true);
    });
});

describe('Alert email recipient placeholder', () => {
    it('uses ALERT_EMAIL_TO when valid', () => {
        assert.equal(
            getAlertEmailRecipient({ ALERT_EMAIL_TO: 'secretaria@ifsul.edu.br' }),
            'secretaria@ifsul.edu.br'
        );
    });

    it('falls back to a placeholder recipient when unset or invalid', () => {
        assert.match(getAlertEmailRecipient({}), /exemplo/);
        assert.match(getAlertEmailRecipient({ ALERT_EMAIL_TO: 'not-an-email' }), /exemplo/);
        assert.match(getAlertEmailRecipient({ ALERT_EMAIL_TO: 'bad\n@example.com' }), /exemplo/);
    });
});

describe('EmailService delivery (fake transport, no network)', () => {
    it('sends HTML with derived text and returns message metadata', async () => {
        const nodemailer = createFakeNodemailer({ testMessageUrl: undefined });
        const service = new EmailService({
            env: { ...SENDER_ENV, SMTP_HOST: 'smtp.example.com' },
            nodemailerModule: nodemailer,
            htmlToTextConverter: () => 'derived plain text'
        });

        const result = await service.send({
            to: 'secretaria@ifsul.edu.br',
            subject: 'Alerta Charqueadas',
            html: '<p>Tempestade severa</p>'
        });

        assert.equal(result.messageId, '<fake-message-id>');
        assert.equal(result.previewUrl, undefined);
        assert.equal(nodemailer.sent.length, 1);
        assert.equal(nodemailer.sent[0].to, 'secretaria@ifsul.edu.br');
        assert.equal(nodemailer.sent[0].subject, 'Alerta Charqueadas');
        assert.equal(nodemailer.sent[0].text, 'derived plain text');
        assert.deepEqual(nodemailer.sent[0].from, {
            name: 'Monitor Charqueadas',
            address: 'monitor@charqueadas.exemplo.edu.br'
        });
    });

    it('compiles MJML strictly and surfaces a dev preview URL', async () => {
        const nodemailer = createFakeNodemailer();
        const mjmlRenderer = createFakeMjml({ html: '<html>compiled</html>' });
        const service = new EmailService({
            env: { ...SENDER_ENV, EMAIL_TESTING: 'true' },
            nodemailerModule: nodemailer,
            mjmlRenderer
        });

        const result = await service.send({
            to: 'secretaria@ifsul.edu.br',
            subject: 'Alerta Charqueadas',
            mjml: '<mjml></mjml>',
            text: 'Texto do alerta'
        });

        assert.equal(mjmlRenderer.calls.length, 1);
        assert.deepEqual(mjmlRenderer.calls[0].options, { validationLevel: 'strict' });
        assert.equal(nodemailer.sent[0].html, '<html>compiled</html>');
        assert.equal(result.previewUrl, 'https://ethereal.email/message/fake-preview');
        assert.equal(nodemailer.createdTransports[0].host, 'smtp.ethereal.email');
    });

    it('rejects MJML validation errors and unresolved placeholders', async () => {
        const nodemailer = createFakeNodemailer();
        const failingMjml = createFakeMjml({ errors: [{ message: 'Invalid tag' }] });
        const service = new EmailService({
            env: { ...SENDER_ENV, SMTP_HOST: 'smtp.example.com' },
            nodemailerModule: nodemailer,
            mjmlRenderer: failingMjml
        });
        await assert.rejects(
            () => service.send({ to: 'a@example.com', subject: 'x', mjml: '<mjml></mjml>' }),
            /MJML validation failed/
        );

        const placeholderService = new EmailService({
            env: { ...SENDER_ENV, SMTP_HOST: 'smtp.example.com' },
            nodemailerModule: nodemailer
        });
        await assert.rejects(
            () => placeholderService.send({ to: 'a@example.com', subject: 'x', html: '<p>{{leftover}}</p>', text: 't' }),
            /unresolved placeholders/
        );
    });

    it('rejects invalid recipients, subjects, and empty content', async () => {
        const nodemailer = createFakeNodemailer();
        const service = new EmailService({
            env: { ...SENDER_ENV, SMTP_HOST: 'smtp.example.com' },
            nodemailerModule: nodemailer
        });
        await assert.rejects(() => service.send({ to: '', subject: 'x', html: '<p>y</p>', text: 'y' }), TypeError);
        await assert.rejects(() => service.send({ to: 'not-an-email', subject: 'x', html: '<p>y</p>', text: 'y' }), TypeError);
        await assert.rejects(() => service.send({ to: 'a@example.com', subject: 'Bad\nSubject', html: '<p>y</p>', text: 'y' }), TypeError);
        await assert.rejects(() => service.send({ to: 'a@example.com', subject: 'x', text: 'y' }), TypeError);
        await assert.rejects(() => service.send({ to: 'a@example.com', subject: 'x', html: '   ', text: 'y' }), TypeError);
    });

    it('verifies and closes the underlying transport', async () => {
        const nodemailer = createFakeNodemailer();
        const service = new EmailService({
            env: { ...SENDER_ENV, SMTP_HOST: 'smtp.example.com' },
            nodemailerModule: nodemailer
        });
        assert.equal(await service.verify(), true);
        assert.equal(nodemailer.state.verified, true);
        await service.close();
        assert.equal(nodemailer.state.closed, true);
    });
});
