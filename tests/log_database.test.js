import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    getDatabase,
    logFetch,
    logAlert,
    logMonitorCycle,
    getRecentFetchLogs,
    getRecentAlertLogs,
    getFetchStats,
    extractEndpoint,
    saveSystemSetting,
    getSystemSetting,
    loadAllSettings,
    closeDatabase
} from '../src/log_database.js';
import { httpGet } from '../src/inmet_client.js';

describe('SQLite Log Database Schema & Basics', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    afterEach(() => {
        closeDatabase(testDb);
    });

    it('creates fetch_logs, alert_logs, and monitor_cycle_logs tables', () => {
        const fetchTable = testDb.findOne('sqlite_master', {
            filter: { type: 'table', name: 'fetch_logs' },
            view: ['name']
        });
        assert.ok(fetchTable, 'fetch_logs table must exist');

        const alertTable = testDb.findOne('sqlite_master', {
            filter: { type: 'table', name: 'alert_logs' },
            view: ['name']
        });
        assert.ok(alertTable, 'alert_logs table must exist');

        const cycleTable = testDb.findOne('sqlite_master', {
            filter: { type: 'table', name: 'monitor_cycle_logs' },
            view: ['name']
        });
        assert.ok(cycleTable, 'monitor_cycle_logs table must exist');

        const indexes = testDb.find('sqlite_master', {
            filter: { type: 'index' },
            view: ['name']
        });
        const indexNames = indexes.map(idx => idx.name);
        assert.ok(indexNames.includes('idx_fetch_logs_timestamp'));
        assert.ok(indexNames.includes('idx_alert_logs_timestamp'));
        assert.ok(indexNames.includes('idx_monitor_cycle_logs_timestamp'));
    });

    it('extracts endpoint pathname from full URLs', () => {
        assert.strictEqual(extractEndpoint('https://apiprevmet3.inmet.gov.br/previsao/4305355'), '/previsao/4305355');
        assert.strictEqual(extractEndpoint('https://apiprevmet3.inmet.gov.br/avisos/ativos'), '/avisos/ativos');
        assert.strictEqual(extractEndpoint('https://apitempo.inmet.gov.br/estacoes/T?format=json'), '/estacoes/T');
        assert.strictEqual(extractEndpoint('/relative/path'), '/relative/path');
        assert.strictEqual(extractEndpoint(''), '');
    });
});

describe('SQLite Fetch & Telemetry Logging Operations', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    afterEach(() => {
        closeDatabase(testDb);
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

        const row = testDb.get('fetch_logs', entry.id);
        assert.ok(row);
        assert.strictEqual(row.status_code, 200);
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

    it('records severe weather alerts in alert_logs', () => {
        const alertEntry = logAlert({
            type: 'Tempestade',
            severity: 'Perigo',
            source: 'INMET',
            affectedCities: ['Charqueadas', 'São Jerônimo'],
            triggerReason: 'Ventos intensos e queda de granizo',
            timeframe: '2026-08-21 00:00 -> 23:59',
            details: 'Chuva entre 30 e 60 mm/h'
        }, testDb);

        assert.ok(alertEntry);
        assert.strictEqual(alertEntry.eventType, 'Tempestade');
        assert.strictEqual(alertEntry.severity, 'Perigo');
        assert.strictEqual(alertEntry.affectedCities, 'Charqueadas, São Jerônimo');

        const recentAlerts = getRecentAlertLogs({ limit: 10 }, testDb);
        assert.strictEqual(recentAlerts.length, 1);
        assert.strictEqual(recentAlerts[0].eventType, 'Tempestade');
    });

    it('records monitoring cycle execution in monitor_cycle_logs', () => {
        const cycle = logMonitorCycle({
            radiusKm: 50,
            citiesCount: 20,
            highRiskCount: 2,
            durationMs: 340,
            success: true
        }, testDb);

        assert.ok(cycle);
        assert.strictEqual(cycle.radiusKm, 50);
        assert.strictEqual(cycle.citiesCount, 20);
        assert.strictEqual(cycle.highRiskCount, 2);
        assert.strictEqual(cycle.success, 1);
    });

    it('handles invalid or empty log input gracefully without crashing', () => {
        assert.strictEqual(logFetch(null, testDb), null);
        assert.strictEqual(logFetch({}, testDb), null);
        assert.strictEqual(logFetch({ url: '' }, testDb), null);
        assert.strictEqual(logAlert(null, testDb), null);
        assert.strictEqual(logAlert({}, testDb), null);
        assert.strictEqual(logMonitorCycle(null, testDb), null);
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

        logAlert({
            type: 'Vendaval',
            severity: 'Perigo Potencial',
            source: 'INMET',
            affectedCities: ['Charqueadas']
        }, testDb);
    });

    afterEach(() => {
        closeDatabase(testDb);
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
        assert.strictEqual(stats.totalAlertsRecorded, 1);
        assert.strictEqual(stats.firstFetchAt, '2026-08-20T10:00:00.000Z');
        assert.strictEqual(stats.lastFetchAt, '2026-08-20T10:10:00.000Z');
    });
});

describe('SQLite System Settings & Config Persistence', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    afterEach(() => {
        closeDatabase(testDb);
    });

    it('saves and retrieves system settings by key', () => {
        saveSystemSetting('inmet_min_severity', 'ORANGE', testDb);
        saveSystemSetting('defesa_civil_min_severity', 'RED', testDb);
        saveSystemSetting('radius_km', '75', testDb);

        assert.strictEqual(getSystemSetting('inmet_min_severity', null, testDb), 'ORANGE');
        assert.strictEqual(getSystemSetting('defesa_civil_min_severity', null, testDb), 'RED');
        assert.strictEqual(getSystemSetting('radius_km', null, testDb), '75');
        assert.strictEqual(getSystemSetting('unknown_key', 'DEFAULT', testDb), 'DEFAULT');
    });

    it('updates existing settings via upsert', () => {
        saveSystemSetting('radius_km', '25', testDb);
        assert.strictEqual(getSystemSetting('radius_km', null, testDb), '25');

        saveSystemSetting('radius_km', '100', testDb);
        assert.strictEqual(getSystemSetting('radius_km', null, testDb), '100');
    });

    it('loads all saved settings as a dictionary', () => {
        saveSystemSetting('inmet_min_severity', 'YELLOW', testDb);
        saveSystemSetting('defesa_civil_min_severity', 'OFF', testDb);

        const all = loadAllSettings(testDb);
        assert.strictEqual(all.inmet_min_severity, 'YELLOW');
        assert.strictEqual(all.defesa_civil_min_severity, 'OFF');
    });
});

