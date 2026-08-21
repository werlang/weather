import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    getDatabase,
    logFetch,
    getRecentFetchLogs,
    getFetchStats,
    extractEndpoint,
    closeDatabase,
    SCHEMA_SQL
} from '../src/log_database.js';
import { httpGet } from '../src/inmet_client.js';

describe('SQLite Log Database Schema & Basics', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    it('creates fetch_logs table and performance indexes', () => {
        const tableInfo = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fetch_logs'").get();
        assert.ok(tableInfo, 'fetch_logs table must exist');

        const indexes = testDb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='fetch_logs'").all();
        const indexNames = indexes.map(idx => idx.name);
        assert.ok(indexNames.includes('idx_fetch_logs_timestamp'));
        assert.ok(indexNames.includes('idx_fetch_logs_endpoint'));
        assert.ok(indexNames.includes('idx_fetch_logs_success'));
    });

    it('extracts endpoint pathname from full URLs', () => {
        assert.strictEqual(extractEndpoint('https://apiprevmet3.inmet.gov.br/previsao/4305355'), '/previsao/4305355');
        assert.strictEqual(extractEndpoint('https://apiprevmet3.inmet.gov.br/avisos/ativos'), '/avisos/ativos');
        assert.strictEqual(extractEndpoint('https://apitempo.inmet.gov.br/estacoes/T?format=json'), '/estacoes/T');
        assert.strictEqual(extractEndpoint('/relative/path'), '/relative/path');
        assert.strictEqual(extractEndpoint(''), '');
    });
});

describe('SQLite Fetch Logging Operations', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    it('records a successful fetch event with metrics', () => {
        const entry = logFetch({
            url: 'https://apiprevmet3.inmet.gov.br/previsao/4305355',
            statusCode: 200,
            durationMs: 145.6,
            success: true,
            responseSizeBytes: 2048,
            itemCount: 5
        }, testDb);

        assert.ok(entry);
        assert.strictEqual(typeof entry.id, 'number');
        assert.strictEqual(entry.url, 'https://apiprevmet3.inmet.gov.br/previsao/4305355');
        assert.strictEqual(entry.endpoint, '/previsao/4305355');
        assert.strictEqual(entry.statusCode, 200);
        assert.strictEqual(entry.durationMs, 146);
        assert.strictEqual(entry.success, 1);
        assert.strictEqual(entry.responseSizeBytes, 2048);
        assert.strictEqual(entry.itemCount, 5);
        assert.strictEqual(entry.errorMessage, null);
        assert.ok(entry.timestamp);

        const rows = testDb.prepare('SELECT * FROM fetch_logs WHERE id = ?').all(entry.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].status_code, 200);
    });

    it('records a failed fetch event with error details', () => {
        const entry = logFetch({
            url: 'https://apiprevmet3.inmet.gov.br/previsao/9999999',
            statusCode: 404,
            durationMs: 80,
            success: false,
            errorMessage: 'HTTP error 404 when fetching resource'
        }, testDb);

        assert.ok(entry);
        assert.strictEqual(entry.success, 0);
        assert.strictEqual(entry.statusCode, 404);
        assert.strictEqual(entry.errorMessage, 'HTTP error 404 when fetching resource');
    });

    it('handles invalid or empty log input gracefully without crashing', () => {
        assert.strictEqual(logFetch(null, testDb), null);
        assert.strictEqual(logFetch({}, testDb), null);
        assert.strictEqual(logFetch({ url: '' }, testDb), null);
    });
});

describe('SQLite Querying & Aggregated Statistics', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');

        // Populate sample data
        logFetch({
            url: 'https://apiprevmet3.inmet.gov.br/previsao/4305355',
            statusCode: 200,
            durationMs: 100,
            success: 1,
            responseSizeBytes: 1000,
            itemCount: 5,
            timestamp: '2026-08-20T10:00:00.000Z'
        }, testDb);

        logFetch({
            url: 'https://apiprevmet3.inmet.gov.br/avisos/ativos',
            statusCode: 200,
            durationMs: 200,
            success: 1,
            responseSizeBytes: 3000,
            itemCount: 12,
            timestamp: '2026-08-20T10:05:00.000Z'
        }, testDb);

        logFetch({
            url: 'https://apiprevmet3.inmet.gov.br/previsao/error',
            statusCode: 500,
            durationMs: 300,
            success: 0,
            errorMessage: 'Internal Server Error',
            timestamp: '2026-08-20T10:10:00.000Z'
        }, testDb);
    });

    it('getRecentFetchLogs returns paginated records in reverse chronological order', () => {
        const logs = getRecentFetchLogs({ limit: 2, offset: 0 }, testDb);
        assert.strictEqual(logs.length, 2);
        assert.strictEqual(logs[0].id, 3); // Most recent first
        assert.strictEqual(logs[1].id, 2);
    });

    it('getRecentFetchLogs filters by success status', () => {
        const successful = getRecentFetchLogs({ success: true }, testDb);
        assert.strictEqual(successful.length, 2);
        assert.ok(successful.every(l => l.success === 1));

        const failed = getRecentFetchLogs({ success: false }, testDb);
        assert.strictEqual(failed.length, 1);
        assert.strictEqual(failed[0].success, 0);
        assert.strictEqual(failed[0].statusCode, 500);
    });

    it('getRecentFetchLogs filters by endpoint substring', () => {
        const forecastLogs = getRecentFetchLogs({ endpoint: 'previsao' }, testDb);
        assert.strictEqual(forecastLogs.length, 2);
        assert.ok(forecastLogs.every(l => l.endpoint.includes('previsao')));
    });

    it('getFetchStats calculates accurate totals and averages', () => {
        const stats = getFetchStats(testDb);
        assert.strictEqual(stats.totalFetches, 3);
        assert.strictEqual(stats.successfulFetches, 2);
        assert.strictEqual(stats.failedFetches, 1);
        assert.strictEqual(stats.avgDurationMs, 200); // (100 + 200 + 300) / 3
        assert.strictEqual(stats.totalResponseBytes, 4000); // 1000 + 3000
        assert.strictEqual(stats.firstFetchAt, '2026-08-20T10:00:00.000Z');
        assert.strictEqual(stats.lastFetchAt, '2026-08-20T10:10:00.000Z');
    });
});
