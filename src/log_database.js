/**
 * SQLite Log Database for Weather API Fetch Requests, Alerts, and Telemetry.
 * Built on the shared SQLite database driver (`src/database_driver.js`).
 * 
 * Provides an audit and performance log of every HTTP fetch executed
 * by the weather monitoring service, CLI tools, and detected severe alerts.
 * 
 * @module logDatabase
 */

import { Sqlite } from './database_driver.js';
import { migrateSync } from './migrate.js';

export const DEFAULT_DB_PATH = process.env.SQLITE_DB_PATH || process.env.DB_PATH || 'database/weather_logs.db';

/**
 * Initializes or returns the shared SQLite database driver instance.
 * Applies versioned migrations from the migrations directory.
 * 
 * @param {string} [dbPath] - Path to the SQLite database file or ':memory:'.
 * @returns {typeof Sqlite} The initialized SQLite database driver.
 */
export function getDatabase(dbPath) {
    const targetPath = dbPath || process.env.SQLITE_DB_PATH || process.env.DB_PATH || DEFAULT_DB_PATH;

    if (targetPath === ':memory:') {
        if (!Sqlite.connected) {
            Sqlite.connect({ path: ':memory:' });
            migrateSync({ dbPath: ':memory:', silent: true, reuseConnection: true });
        }
        return Sqlite;
    }

    if (!Sqlite.connected) {
        Sqlite.connect({ path: targetPath });
        migrateSync({ dbPath: targetPath, silent: true, reuseConnection: true });
    }

    return Sqlite;
}

/**
 * Extracts a normalized endpoint/pathname from a full URL.
 * 
 * @param {string} url - Target URL.
 * @returns {string} Pathname or original string.
 */
export function extractEndpoint(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        return parsed.pathname;
    } catch {
        return url;
    }
}

/**
 * Logs an HTTP fetch operation into SQLite using the driver.
 * 
 * @param {object} logData
 * @param {string} logData.url - Full URL fetched.
 * @param {string} [logData.endpoint] - Optional endpoint pathname.
 * @param {number|null} [logData.statusCode] - HTTP status code.
 * @param {number|null} [logData.durationMs] - Request latency in milliseconds.
 * @param {boolean|number} [logData.success=true] - Whether request succeeded.
 * @param {number|null} [logData.responseSizeBytes] - Size in bytes of response body.
 * @param {number|null} [logData.itemCount] - Number of items/records in response.
 * @param {string|null} [logData.errorMessage] - Error details if failed.
 * @param {string|null} [logData.timestamp] - ISO timestamp (defaults to current time).
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {object|null} The inserted log record metadata.
 */
export function logFetch(logData, customDriver = null) {
    if (!logData || !logData.url) {
        return null;
    }

    try {
        const db = customDriver || getDatabase();
        const endpoint = logData.endpoint || extractEndpoint(logData.url);
        const success = (logData.success === false || logData.success === 0) ? 0 : 1;
        const statusCode = typeof logData.statusCode === 'number' ? logData.statusCode : null;
        const durationMs = typeof logData.durationMs === 'number' ? Math.round(logData.durationMs) : null;
        const responseSizeBytes = typeof logData.responseSizeBytes === 'number' ? Math.round(logData.responseSizeBytes) : null;
        const itemCount = typeof logData.itemCount === 'number' ? Math.round(logData.itemCount) : null;
        const errorMessage = logData.errorMessage ? String(logData.errorMessage) : null;
        const timestamp = logData.timestamp || new Date().toISOString();

        const [inserted] = db.insert('fetch_logs', {
            timestamp,
            url: logData.url,
            endpoint,
            status_code: statusCode,
            duration_ms: durationMs,
            success,
            response_size_bytes: responseSizeBytes,
            item_count: itemCount,
            error_message: errorMessage
        });

        return {
            id: inserted.id,
            timestamp: inserted.timestamp,
            url: inserted.url,
            endpoint: inserted.endpoint,
            statusCode: inserted.status_code,
            durationMs: inserted.duration_ms,
            success: inserted.success,
            responseSizeBytes: inserted.response_size_bytes,
            itemCount: inserted.item_count,
            errorMessage: inserted.error_message
        };
    } catch (err) {
        console.error('⚠️ [SQLite Log Error] Failed to write fetch log:', err.message);
        return null;
    }
}

/**
 * Logs a detected severe weather alert event into SQLite using the driver.
 * 
 * @param {object} alertData
 * @param {string} alertData.type - Alert type / hazard name.
 * @param {string} [alertData.severity] - Severity level.
 * @param {string} [alertData.source] - Data origin (INMET, DEFESA_CIVIL).
 * @param {Array<string>|string} [alertData.affectedCities] - Municipalities affected.
 * @param {string} [alertData.triggerReason] - Reason for trigger.
 * @param {string} [alertData.timeframe] - Event window.
 * @param {string} [alertData.details] - Full event description.
 * @param {string} [alertData.timestamp] - ISO timestamp.
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {object|null} The inserted alert record metadata.
 */
export function logAlert(alertData, customDriver = null) {
    if (!alertData || (!alertData.type && !alertData.event_type)) {
        return null;
    }

    try {
        const db = customDriver || getDatabase();
        const timestamp = alertData.timestamp || new Date().toISOString();
        const eventType = alertData.type || alertData.event_type;
        const severity = alertData.severity || null;
        const source = alertData.source || null;
        const affectedCities = Array.isArray(alertData.affectedCities)
            ? alertData.affectedCities.join(', ')
            : (alertData.affectedCities || null);
        const triggerReason = alertData.triggerReason || alertData.trigger_reason || null;
        const timeframe = alertData.timeframe || null;
        const details = alertData.details || null;

        const [inserted] = db.insert('alert_logs', {
            timestamp,
            event_type: eventType,
            severity,
            source,
            affected_cities: affectedCities,
            trigger_reason: triggerReason,
            timeframe,
            details
        });

        return {
            id: inserted.id,
            timestamp: inserted.timestamp,
            eventType: inserted.event_type,
            severity: inserted.severity,
            source: inserted.source,
            affectedCities: inserted.affected_cities,
            triggerReason: inserted.trigger_reason,
            timeframe: inserted.timeframe,
            details: inserted.details
        };
    } catch (err) {
        console.error('⚠️ [SQLite Alert Log Error] Failed to write alert log:', err.message);
        return null;
    }
}

/**
 * Logs a completed regional monitoring cycle into SQLite using the driver.
 * 
 * @param {object} cycleData
 * @param {number} [cycleData.radiusKm] - Coverage radius in km.
 * @param {number} [cycleData.citiesCount] - Number of verified cities.
 * @param {number} [cycleData.highRiskCount] - Number of high risk events detected.
 * @param {number} [cycleData.durationMs] - Cycle latency in ms.
 * @param {boolean|number} [cycleData.success=true] - Whether cycle completed without fatal error.
 * @param {string} [cycleData.errorMessage] - Error details if failed.
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {object|null} Inserted cycle record metadata.
 */
export function logMonitorCycle(cycleData, customDriver = null) {
    if (!cycleData) return null;

    try {
        const db = customDriver || getDatabase();
        const timestamp = cycleData.timestamp || new Date().toISOString();
        const radiusKm = typeof cycleData.radiusKm === 'number' ? cycleData.radiusKm : null;
        const citiesCount = typeof cycleData.citiesCount === 'number' ? cycleData.citiesCount : null;
        const highRiskCount = typeof cycleData.highRiskCount === 'number' ? cycleData.highRiskCount : 0;
        const durationMs = typeof cycleData.durationMs === 'number' ? Math.round(cycleData.durationMs) : null;
        const success = (cycleData.success === false || cycleData.success === 0) ? 0 : 1;
        const errorMessage = cycleData.errorMessage ? String(cycleData.errorMessage) : null;

        const [inserted] = db.insert('monitor_cycle_logs', {
            timestamp,
            radius_km: radiusKm,
            cities_count: citiesCount,
            high_risk_count: highRiskCount,
            duration_ms: durationMs,
            success,
            error_message: errorMessage
        });

        return {
            id: inserted.id,
            timestamp: inserted.timestamp,
            radiusKm: inserted.radius_km,
            citiesCount: inserted.cities_count,
            highRiskCount: inserted.high_risk_count,
            durationMs: inserted.duration_ms,
            success: inserted.success,
            errorMessage: inserted.error_message
        };
    } catch (err) {
        console.error('⚠️ [SQLite Monitor Cycle Log Error] Failed to write cycle log:', err.message);
        return null;
    }
}

/**
 * Queries recent fetch logs from SQLite with filtering and pagination via driver.
 * 
 * @param {object} [options]
 * @param {number} [options.limit=50] - Number of records to return.
 * @param {number} [options.offset=0] - Offset for pagination.
 * @param {boolean|number} [options.success] - Filter by success status (true/false/1/0).
 * @param {string} [options.endpoint] - Filter by endpoint substring.
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {Array<object>} Array of log records.
 */
export function getRecentFetchLogs({ limit = 50, offset = 0, success = null, endpoint = null } = {}, customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const filter = {};

        if (success !== null && success !== undefined) {
            filter.success = (success === true || success === 1) ? 1 : 0;
        }

        if (endpoint) {
            filter.endpoint = Sqlite.like(endpoint);
        }

        const rows = db.find('fetch_logs', {
            filter,
            view: [
                'id',
                'timestamp',
                'url',
                'endpoint',
                'status_code',
                'duration_ms',
                'success',
                'response_size_bytes',
                'item_count',
                'error_message'
            ],
            opt: {
                order: { id: -1 },
                limit: Math.max(1, limit),
                skip: Math.max(0, offset)
            }
        });

        return rows.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            url: r.url,
            endpoint: r.endpoint,
            statusCode: r.status_code,
            durationMs: r.duration_ms,
            success: r.success,
            responseSizeBytes: r.response_size_bytes,
            itemCount: r.item_count,
            errorMessage: r.error_message
        }));
    } catch (err) {
        console.error('⚠️ [SQLite Query Error] Failed to fetch logs:', err.message);
        return [];
    }
}

/**
 * Queries recent alert logs from SQLite via driver.
 * 
 * @param {object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.offset=0]
 * @param {typeof Sqlite} [customDriver]
 * @returns {Array<object>}
 */
export function getRecentAlertLogs({ limit = 20, offset = 0 } = {}, customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const rows = db.find('alert_logs', {
            view: [
                'id',
                'timestamp',
                'event_type',
                'severity',
                'source',
                'affected_cities',
                'trigger_reason',
                'timeframe',
                'details'
            ],
            opt: {
                order: { id: -1 },
                limit: Math.max(1, limit),
                skip: Math.max(0, offset)
            }
        });

        return rows.map(a => ({
            id: a.id,
            timestamp: a.timestamp,
            eventType: a.event_type,
            severity: a.severity,
            source: a.source,
            affectedCities: a.affected_cities,
            triggerReason: a.trigger_reason,
            timeframe: a.timeframe,
            details: a.details
        }));
    } catch (err) {
        console.error('⚠️ [SQLite Alert Query Error] Failed to fetch alert logs:', err.message);
        return [];
    }
}

/**
 * Returns aggregated statistics for all logged API fetch requests via driver.
 * 
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {object} Aggregated stats.
 */
export function getFetchStats(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const stats = db.findOne('fetch_logs', {
            view: [
                Sqlite.raw('COUNT(*) AS totalFetches'),
                Sqlite.raw('COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS successfulFetches'),
                Sqlite.raw('COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failedFetches'),
                Sqlite.raw('COALESCE(ROUND(AVG(duration_ms), 2), 0) AS avgDurationMs'),
                Sqlite.raw('COALESCE(SUM(response_size_bytes), 0) AS totalResponseBytes'),
                Sqlite.raw('MIN(timestamp) AS firstFetchAt'),
                Sqlite.raw('MAX(timestamp) AS lastFetchAt')
            ]
        }) || {};

        const alertCount = db.count('alert_logs');
        const cycleCount = db.count('monitor_cycle_logs');

        return {
            totalFetches: Number(stats.totalFetches || 0),
            successfulFetches: Number(stats.successfulFetches || 0),
            failedFetches: Number(stats.failedFetches || 0),
            avgDurationMs: Number(stats.avgDurationMs || 0),
            totalResponseBytes: Number(stats.totalResponseBytes || 0),
            totalAlertsRecorded: Number(alertCount || 0),
            totalCyclesRecorded: Number(cycleCount || 0),
            firstFetchAt: stats.firstFetchAt || null,
            lastFetchAt: stats.lastFetchAt || null
        };
    } catch (err) {
        console.error('⚠️ [SQLite Stats Error] Failed to get fetch stats:', err.message);
        return {
            totalFetches: 0,
            successfulFetches: 0,
            failedFetches: 0,
            avgDurationMs: 0,
            totalResponseBytes: 0,
            totalAlertsRecorded: 0,
            totalCyclesRecorded: 0,
            firstFetchAt: null,
            lastFetchAt: null
        };
    }
}

/**
 * Closes the active database connection.
 * 
 * @param {typeof Sqlite} [customDriver] - Driver instance to close.
 */
/**
 * Saves or updates a system setting in the SQLite database.
 * 
 * @param {string} key - Setting key (e.g. 'inmet_min_severity', 'defesa_civil_min_severity', 'radius_km', 'interval_minutes').
 * @param {string|number} value - Setting value.
 * @param {typeof Sqlite} [customDriver] - Optional custom DB driver.
 * @returns {boolean} True if saved.
 */
export function saveSystemSetting(key, value, customDriver = null) {
    if (!key) return false;
    try {
        const db = customDriver || getDatabase();
        const valueStr = String(value);
        const updatedAt = new Date().toISOString();

        db.upsert('system_settings', {
            key,
            value: valueStr,
            updated_at: updatedAt
        }, { conflictFields: ['key'] });

        return true;
    } catch (err) {
        console.error(`⚠️ [SQLite Settings Error] Failed to save setting "${key}":`, err.message);
        return false;
    }
}

/**
 * Retrieves a single system setting by key from SQLite.
 * 
 * @param {string} key
 * @param {string|null} [defaultValue=null]
 * @param {typeof Sqlite} [customDriver]
 * @returns {string|null}
 */
export function getSystemSetting(key, defaultValue = null, customDriver = null) {
    if (!key) return defaultValue;
    try {
        const db = customDriver || getDatabase();
        const row = db.findOne('system_settings', {
            filter: { key },
            view: ['value']
        });
        return row ? row.value : defaultValue;
    } catch {
        return defaultValue;
    }
}

/**
 * Loads all system settings from SQLite as a key-value dictionary.
 * 
 * @param {typeof Sqlite} [customDriver]
 * @returns {Record<string, string>}
 */
export function loadAllSettings(customDriver = null) {
    try {
        const db = customDriver || getDatabase();
        const rows = db.find('system_settings', {
            view: ['key', 'value']
        });
        const result = {};
        for (const row of rows) {
            result[row.key] = row.value;
        }
        return result;
    } catch {
        return {};
    }
}

export function closeDatabase(customDriver = null) {
    if (customDriver && typeof customDriver.close === 'function') {
        try { customDriver.close(); } catch {}
        return;
    }
    Sqlite.close();
}

// CLI utility runner: prints database statistics and recent logs
if (import.meta.url === `file://${process.argv[1]}`) {
    const stats = getFetchStats();
    console.log('='.repeat(80));
    console.log(' WEATHER API FETCH LOGS & TELEMETRY (SQLITE)');
    console.log('='.repeat(80));
    console.log(` • Database File:      ${DEFAULT_DB_PATH}`);
    console.log(` • Total Fetches:      ${stats.totalFetches}`);
    console.log(` • Successful:         ${stats.successfulFetches}`);
    console.log(` • Failed:             ${stats.failedFetches}`);
    console.log(` • Avg Latency:        ${stats.avgDurationMs} ms`);
    console.log(` • Total Bytes:        ${(stats.totalResponseBytes / 1024).toFixed(2)} KB`);
    console.log(` • Alerts Recorded:    ${stats.totalAlertsRecorded}`);
    console.log(` • Cycles Recorded:    ${stats.totalCyclesRecorded}`);
    console.log(` • First Log:          ${stats.firstFetchAt || 'N/A'}`);
    console.log(` • Latest Log:         ${stats.lastFetchAt || 'N/A'}`);
    console.log('='.repeat(80));

    const recent = getRecentFetchLogs({ limit: 10 });
    if (recent.length > 0) {
        console.log('\nÚltimos 10 registros de fetch:');
        console.table(recent.map(r => ({
            ID: r.id,
            Hora: r.timestamp.substring(11, 19),
            Endpoint: r.endpoint,
            Status: r.statusCode || 'ERR',
            Latência: `${r.durationMs}ms`,
            StatusOK: r.success === 1 ? '✓' : '✗',
            Bytes: r.responseSizeBytes ?? '-',
            Itens: r.itemCount ?? '-'
        })));
    } else {
        console.log('\nNenhum registro de fetch encontrado no banco.');
    }

    const recentAlerts = getRecentAlertLogs({ limit: 5 });
    if (recentAlerts.length > 0) {
        console.log('\nÚltimos 5 alertas severos registrados no banco:');
        console.table(recentAlerts.map(a => ({
            ID: a.id,
            Hora: a.timestamp.substring(11, 19),
            Evento: a.eventType,
            Severidade: a.severity || 'N/A',
            Origem: a.source || 'N/A',
            Municípios: a.affectedCities || 'N/A'
        })));
    }
}
