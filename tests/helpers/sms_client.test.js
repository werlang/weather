import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SmsConfigurationError,
    SmsService,
    countSmsSegments,
    getSmsConfig,
    getSmsService,
    normalizeSmsNumber
} from '../../src/helpers/sms_client.js';

/** Minimum viable production environment (valid key, real gateway). */
const PROD_ENV = { NODE_ENV: 'production', SMSDEV_KEY: 'k'.repeat(40) };

/**
 * Builds a fake fetch capturing calls and replaying a canned payload.
 *
 * @param {unknown} payload - JSON body returned to the caller.
 * @param {object} [options] - Behaviour flags.
 * @param {number} [options.status=200] - HTTP status code.
 * @returns {{ calls: Array<{url: string, options: object}>, fetchImpl: Function }} Capture harness.
 */
function createCaptureFetch(payload, { status = 200 } = {}) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return {
            ok: status >= 200 && status < 300,
            status,
            async json() { return payload; },
            async text() { return JSON.stringify(payload); }
        };
    };
    return { calls, fetchImpl };
}

describe('getSmsConfig environment contract', () => {
    it('rejects SMS_TESTING in production', () => {
        assert.throws(
            () => getSmsConfig({ NODE_ENV: 'production', SMSDEV_KEY: 'abc', SMS_TESTING: 'true' }),
            SmsConfigurationError
        );
    });

    it('requires the key in production', () => {
        assert.throws(() => getSmsConfig({ NODE_ENV: 'production' }), SmsConfigurationError);
        assert.throws(() => getSmsConfig({ NODE_ENV: 'production', SMSDEV_KEY: '   ' }), SmsConfigurationError);
    });

    it('allows a missing key outside production (testing mode)', () => {
        const config = getSmsConfig({ SMS_TESTING: 'true' });
        assert.equal(config.testing, true);
        assert.equal(config.key, undefined);
    });

    it('rejects keys longer than the documented 128 characters', () => {
        assert.throws(() => getSmsConfig({ SMSDEV_KEY: 'x'.repeat(129) }), SmsConfigurationError);
    });

    it('defaults to the official https endpoint and trims a trailing slash', () => {
        const config = getSmsConfig(PROD_ENV);
        assert.equal(config.baseUrl, 'https://api.smsdev.com.br/v1');
        assert.equal(getSmsConfig({ ...PROD_ENV, SMSDEV_BASE_URL: 'https://mirror.example/v1/' }).baseUrl, 'https://mirror.example/v1');
    });

    it('rejects a non-https base URL', () => {
        assert.throws(() => getSmsConfig({ ...PROD_ENV, SMSDEV_BASE_URL: 'http://insecure.example' }), SmsConfigurationError);
        assert.throws(() => getSmsConfig({ ...PROD_ENV, SMSDEV_BASE_URL: 'ftp://nope' }), SmsConfigurationError);
    });
});

describe('normalizeSmsNumber (Brazilian E.164)', () => {
    it('prefixes the country code on national numbers', () => {
        assert.equal(normalizeSmsNumber('43999998888'), '5543999998888');
        assert.equal(normalizeSmsNumber('(43) 99999-8888'), '5543999998888');
        assert.equal(normalizeSmsNumber('4333334444'), '554333334444');
    });

    it('keeps an already complete international number', () => {
        assert.equal(normalizeSmsNumber('5543999998888'), '5543999998888');
        assert.equal(normalizeSmsNumber('+55 43 99999-8888'), '5543999998888');
        assert.equal(normalizeSmsNumber('554333334444'), '554333334444');
    });

    it('rejects malformed candidates', () => {
        assert.throws(() => normalizeSmsNumber(''), TypeError);
        assert.throws(() => normalizeSmsNumber('abc'), TypeError);
        assert.throws(() => normalizeSmsNumber('12345'), TypeError);
        assert.throws(() => normalizeSmsNumber(null), TypeError);
        // DDD must be a valid Brazilian code (11-99), so 01 is rejected.
        assert.throws(() => normalizeSmsNumber('01999998888'), TypeError);
        // Subscriber digits cannot start with 0.
        assert.throws(() => normalizeSmsNumber('4303334444'), TypeError);
    });
});

describe('countSmsSegments credit math', () => {
    it('charges one segment up to 160 characters', () => {
        assert.equal(countSmsSegments('a'.repeat(160)), 1);
        assert.equal(countSmsSegments('a'.repeat(1)), 1);
    });

    it('adds a segment past each 160-character boundary', () => {
        assert.equal(countSmsSegments('a'.repeat(161)), 2);
        assert.equal(countSmsSegments('a'.repeat(320)), 2);
        assert.equal(countSmsSegments('a'.repeat(321)), 3);
    });

    it('measures Unicode code points, not UTF-16 units', () => {
        // Each 'ã' is one code point but would count twice via .length on some inputs.
        assert.equal(countSmsSegments('ã'.repeat(160)), 1);
    });

    it('never reports fewer than one segment', () => {
        assert.equal(countSmsSegments(''), 1);
    });
});

describe('SmsService.send', () => {
    it('posts a JSON array of message objects with type 9', async () => {
        const { calls, fetchImpl } = createCaptureFetch([
            { situacao: 'OK', codigo: '1', id: '637849052', descricao: 'MENSAGEM NA FILA' }
        ]);
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        const result = await service.send({ numbers: ['43999998888'], body: 'Alerta de chuva forte.' });

        assert.equal(calls.length, 1);
        assert.match(calls[0].url, /\/send$/);
        assert.equal(calls[0].options.method, 'POST');
        assert.equal(calls[0].options.headers['Content-Type'], 'application/json');

        const body = JSON.parse(calls[0].options.body);
        assert.equal(body.length, 1);
        assert.equal(body[0].key, PROD_ENV.SMSDEV_KEY);
        assert.equal(body[0].type, 9);
        assert.equal(body[0].number, '5543999998888');
        assert.equal(body[0].msg, 'Alerta de chuva forte.');

        assert.equal(result.testing, undefined);
        assert.equal(result.recipients, 1);
        assert.equal(result.accepted, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.credits, 1);
        assert.equal(result.results[0].id, '637849052');
    });

    it('sends every recipient in a single request and computes credits', async () => {
        const { calls, fetchImpl } = createCaptureFetch([
            { situacao: 'OK', codigo: '1', id: '1', descricao: 'MENSAGEM NA FILA' },
            { situacao: 'OK', codigo: '1', id: '2', descricao: 'MENSAGEM NA FILA' },
            { situacao: 'ERRO', codigo: '10', id: '3', descricao: 'SALDO INSUFICIENTE' }
        ]);
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        const longBody = 'x'.repeat(200); // 2 segments
        const result = await service.send({
            numbers: ['43999998888', '51988887777', '554377776666'],
            body: longBody
        });

        assert.equal(calls.length, 1);
        const body = JSON.parse(calls[0].options.body);
        assert.equal(body.length, 3);
        assert.deepEqual(body.map(m => m.number), ['5543999998888', '5551988887777', '554377776666']);

        assert.equal(result.segments, 2);
        assert.equal(result.credits, 6); // 2 segments x 3 recipients
        assert.equal(result.accepted, 2);
        assert.equal(result.failed, 1);
    });

    it('counts recipients missing from the gateway response as failed', async () => {
        const { fetchImpl } = createCaptureFetch([
            { situacao: 'OK', codigo: '1', id: '1', descricao: 'MENSAGEM NA FILA' }
        ]);
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        const result = await service.send({ numbers: ['43999998888', '51988887777'], body: 'oi' });
        assert.equal(result.recipients, 2);
        assert.equal(result.accepted, 1);
        assert.equal(result.failed, 1);
    });

    it('skips the network entirely in testing mode', async () => {
        const { calls, fetchImpl } = createCaptureFetch([]);
        const service = new SmsService({ env: { SMS_TESTING: 'true' }, fetchImpl });

        const result = await service.send({ numbers: ['43999998888'], body: 'simulado' });

        assert.equal(calls.length, 0);
        assert.equal(result.testing, true);
        assert.equal(result.accepted, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.results[0].situacao, 'OK');
        assert.match(result.results[0].descricao, /SIMULADA/);
    });

    it('rejects an empty recipient list or body before any request', async () => {
        const { calls, fetchImpl } = createCaptureFetch([]);
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        await assert.rejects(() => service.send({ numbers: [], body: 'oi' }), TypeError);
        await assert.rejects(() => service.send({ numbers: ['43999998888'], body: '   ' }), TypeError);
        assert.equal(calls.length, 0);
    });

    it('normalizes every recipient and rejects malformed ones', async () => {
        const { fetchImpl } = createCaptureFetch([]);
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        await assert.rejects(() => service.send({ numbers: ['43999998888', 'not-a-phone'], body: 'oi' }), TypeError);
    });

    it('surfaces HTTP failures as errors the bot can contain', async () => {
        const { fetchImpl } = createCaptureFetch({ mensagem: 'unauthorized' }, { status: 401 });
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        await assert.rejects(() => service.send({ numbers: ['43999998888'], body: 'oi' }));
    });

    it('handles a single-object gateway response', async () => {
        const { fetchImpl } = createCaptureFetch({ situacao: 'ERRO', codigo: '5', descricao: 'CHAVE INVALIDA' });
        const service = new SmsService({ env: PROD_ENV, fetchImpl });

        const result = await service.send({ numbers: ['43999998888'], body: 'oi' });
        assert.equal(result.accepted, 0);
        assert.equal(result.failed, 1);
        assert.equal(result.results[0].descricao, 'CHAVE INVALIDA');
    });
});

describe('getSmsService singleton', () => {
    it('caches the process-wide instance', () => {
        assert.equal(getSmsService(), getSmsService());
    });
});
