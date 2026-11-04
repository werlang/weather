import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    createDevNotifier,
    formatDevNotification,
    DEFAULT_DEV_NOTIFY_COOLDOWN_MS,
    DEV_NOTIFY_MAX_LENGTH
} from '../../src/helpers/dev_notifier.js';

describe('Developer operational notifier', () => {
    it('is disabled when no developer chat ID is configured', async () => {
        let sent = 0;
        const notifier = createDevNotifier({
            chatId: null,
            sendMessage: async () => { sent += 1; }
        });

        assert.strictEqual(notifier.enabled, false);
        assert.strictEqual(await notifier.notify({ key: 'anything' }), false);
        assert.strictEqual(sent, 0);
    });

    it('sends a formatted plain message to the developer chat only', async () => {
        const sent = [];
        const notifier = createDevNotifier({
            chatId: '4242',
            sendMessage: async (chatId, message) => { sent.push({ chatId, message }); }
        });

        const delivered = await notifier.notify({
            key: 'monitor-data-quality',
            component: 'monitor',
            title: 'Ciclo com dados incompletos',
            error: 'Defesa Civil GraphQL error 400',
            details: ['38 municípios', '1 evento de alto risco']
        });

        assert.strictEqual(delivered, true);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].chatId, '4242');
        assert.match(sent[0].message, /\[DEV\] monitor/);
        assert.match(sent[0].message, /Ciclo com dados incompletos/);
        assert.match(sent[0].message, /monitor-data-quality/);
        assert.match(sent[0].message, /Defesa Civil GraphQL error 400/);
        assert.match(sent[0].message, /38 municípios \| 1 evento de alto risco/);
    });

    it('rate-limits identical error keys but lets a different key through', async () => {
        let now = 0;
        let sent = 0;
        const notifier = createDevNotifier({
            chatId: '4242',
            cooldownMs: DEFAULT_DEV_NOTIFY_COOLDOWN_MS,
            now: () => now,
            sendMessage: async () => { sent += 1; }
        });

        assert.strictEqual(await notifier.notify({ key: 'monitor-data-quality' }), true);
        now = 5 * 60 * 60 * 1000;
        assert.strictEqual(await notifier.notify({ key: 'monitor-data-quality' }), false);
        assert.strictEqual(sent, 1);

        assert.strictEqual(await notifier.notify({ key: 'telegram-polling' }), true);
        assert.strictEqual(sent, 2);

        now = DEFAULT_DEV_NOTIFY_COOLDOWN_MS + 1;
        assert.strictEqual(await notifier.notify({ key: 'monitor-data-quality' }), true);
        assert.strictEqual(sent, 3);
    });

    it('retries the same key after a transport failure instead of cooling down', async () => {
        let attempts = 0;
        const notifier = createDevNotifier({
            chatId: '4242',
            sendMessage: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('telegram unavailable');
            },
            logger: { error() {} }
        });

        assert.strictEqual(await notifier.notify({ key: 'monitor-cycle', error: 'boom' }), false);
        assert.strictEqual(await notifier.notify({ key: 'monitor-cycle', error: 'boom' }), true);
        assert.strictEqual(attempts, 2);
    });

    it('never throws when the transport or formatting fails', async () => {
        const notifier = createDevNotifier({
            chatId: '4242',
            sendMessage: async () => { throw new Error('network down'); },
            logger: { error() {} }
        });

        await assert.doesNotReject(async () => {
            assert.strictEqual(await notifier.notify({ key: 'monitor-cycle', error: new Error('original') }), false);
        });
    });

    it('caps the message below the Telegram size limit', () => {
        const message = formatDevNotification({
            component: 'monitor',
            key: 'huge-error',
            title: 'Erro enorme',
            error: 'x'.repeat(10_000)
        });

        assert.ok(Array.from(message).length <= DEV_NOTIFY_MAX_LENGTH);
        assert.match(message, /\[DEV\] monitor/);
    });
});
