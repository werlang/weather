/**
 * SQLite Log Database for Weather API Fetch Requests.
 * Built using native Node.js 26 `node:sqlite` (DatabaseSync).
 * 
 * Provides an audit and performance log of every HTTP fetch executed
 * by the weather monitoring service and CLI tools.
 * 
 * @module logDatabase
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export const DEFAULT_DB_PATH = process.env.SQLITE_DB_PATH || process.env.DB_PATH || 'database/weather_logs.db';

let defaultDbInstance = null;

/**
 * SQL Schema for the fetch_logs table and performance indexes.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS fetch_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    url TEXT NOT NULL,
    endpoint TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    response_size_bytes INTEGER,
    item_count INTEGER,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_timestamp ON fetch_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_endpoint ON fetch_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_success ON fetch_logs(success);
`;

/**
 * Initializes or returns an active SQLite database instance.
 * Applies table and index creation idempotently.
 * 
 * @param {string} [dbPath=DEFAULT_DB_PATH] - Path to the SQLite database file or ':memory:'.
 * @returns {DatabaseSync} The initialized SQLite database instance.
 */
export function getDatabase(dbPath = DEFAULT_DB_PATH) {
    if (dbPath === ':memory:') {
        const memDb = new DatabaseSync(':memory:');
        memDb.exec(SCHEMA_SQL);
        return memDb;
    }

    if (defaultDbInstance && dbPath === DEFAULT_DB_PATH) {
        return defaultDbInstance;
    }

    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    const db = new DatabaseSync(resolvedPath);
    
    // Performance and reliability pragmas
    try {
        db.exec('PRAGMA journal_mode = WAL;');
        db.exec('PRAGMA synchronous = NORMAL;');
    } catch {
        // WAL mode may not apply to all environments (e.g. read-only)
    }

    db.exec(SCHEMA_SQL);

    if (dbPath === DEFAULT_DB_PATH) {
        defaultDbInstance = db;
    }

    return db;
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
 * Logs an HTTP fetch operation into SQLite.
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
 * @param {DatabaseSync} [customDb] - Optional custom DB instance (useful for tests).
 * @returns {object|null} The inserted log record metadata.
 */
export function logFetch(logData, customDb = null) {
    if (!logData || !logData.url) {
        return null;
    }

    try {
        const db = customDb || getDatabase();
        const endpoint = logData.endpoint || extractEndpoint(logData.url);
        const success = (logData.success === false || logData.success === 0) ? 0 : 1;
        const statusCode = typeof logData.statusCode === 'number' ? logData.statusCode : null;
        const durationMs = typeof logData.durationMs === 'number' ? Math.round(logData.durationMs) : null;
        const responseSizeBytes = typeof logData.responseSizeBytes === 'number' ? Math.round(logData.responseSizeBytes) : null;
        const itemCount = typeof logData.itemCount === 'number' ? Math.round(logData.itemCount) : null;
        const errorMessage = logData.errorMessage ? String(logData.errorMessage) : null;
        const timestamp = logData.timestamp || new Date().toISOString();

        const insertStmt = db.prepare(`
            INSERT INTO fetch_logs (
                timestamp,
                url,
                endpoint,
                status_code,
                duration_ms,
                success,
                response_size_bytes,
                item_count,
                error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = insertStmt.run(
            timestamp,
            logData.url,
            endpoint,
            statusCode,
            durationMs,
            success,
            responseSizeBytes,
            itemCount,
            errorMessage
        );

        return {
            id: Number(result.lastInsertRowid),
            timestamp,
            url: logData.url,
            endpoint,
            statusCode,
            durationMs,
            success,
            responseSizeBytes,
            itemCount,
            errorMessage
        };
    } catch (err) {
        console.error('⚠️ [SQLite Log Error] Failed to write fetch log:', err.message);
        return null;
    }
}

/**
 * Queries recent fetch logs from SQLite with filtering and pagination.
 * 
 * @param {object} [options]
 * @param {number} [options.limit=50] - Number of records to return.
 * @param {number} [options.offset=0] - Offset for pagination.
 * @param {boolean|number} [options.success] - Filter by success status (true/false/1/0).
 * @param {string} [options.endpoint] - Filter by endpoint substring.
 * @param {DatabaseSync} [customDb] - Optional custom DB instance.
 * @returns {Array<object>} Array of log records.
 */
export function getRecentFetchLogs({ limit = 50, offset = 0, success = null, endpoint = null } = {}, customDb = null) {
    try {
        const db = customDb || getDatabase();
        const conditions = [];
        const params = [];

        if (success !== null && success !== undefined) {
            conditions.push('success = ?');
            params.push(success ? 1 : 0);
        }

        if (endpoint) {
            conditions.push('endpoint LIKE ?');
            params.push(`%${endpoint}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const query = `
            SELECT 
                id,
                timestamp,
                url,
                endpoint,
                status_code AS statusCode,
                duration_ms AS durationMs,
                success,
                response_size_bytes AS responseSizeBytes,
                item_count AS itemCount,
                error_message AS errorMessage
            FROM fetch_logs
            ${whereClause}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        `;

        params.push(Math.max(1, limit), Math.max(0, offset));
        return db.prepare(query).all(...params);
    } catch (err) {
        console.error('⚠️ [SQLite Query Error] Failed to fetch logs:', err.message);
        return [];
    }
}

/**
 * Returns aggregated statistics for all logged API fetch requests.
 * 
 * @param {DatabaseSync} [customDb] - Optional custom DB instance.
 * @returns {object} Aggregated stats.
 */
export function getFetchStats(customDb = null) {
    try {
        const db = customDb || getDatabase();
        const stats = db.prepare(`
            SELECT 
                COUNT(*) AS totalFetches,
                COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS successfulFetches,
                COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failedFetches,
                COALESCE(ROUND(AVG(duration_ms), 2), 0) AS avgDurationMs,
                COALESCE(SUM(response_size_bytes), 0) AS totalResponseBytes,
                MIN(timestamp) AS firstFetchAt,
                MAX(timestamp) AS lastFetchAt
            FROM fetch_logs
        `).get();

        return {
            totalFetches: Number(stats.totalFetches || 0),
            successfulFetches: Number(stats.successfulFetches || 0),
            failedFetches: Number(stats.failedFetches || 0),
            avgDurationMs: Number(stats.avgDurationMs || 0),
            totalResponseBytes: Number(stats.totalResponseBytes || 0),
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
            firstFetchAt: null,
            lastFetchAt: null
        };
    }
}

/**
 * Closes the active database connection.
 * 
 * @param {DatabaseSync} [customDb] - Database instance to close.
 */
export function closeDatabase(customDb = null) {
    if (customDb) {
        try { customDb.close(); } catch {}
        return;
    }
    if (defaultDbInstance) {
        try { defaultDbInstance.close(); } catch {}
        defaultDbInstance = null;
    }
}

// CLI utility runner: prints database statistics and recent logs
if (import.meta.url === `file://${process.argv[1]}`) {
    const stats = getFetchStats();
    console.log('='.repeat(80));
    console.log(' WEATHER API FETCH LOGS & STATISTICS (SQLITE)');
    console.log('='.repeat(80));
    console.log(` • Database File:      ${DEFAULT_DB_PATH}`);
    console.log(` • Total Fetches:      ${stats.totalFetches}`);
    console.log(` • Successful:         ${stats.successfulFetches}`);
    console.log(` • Failed:             ${stats.failedFetches}`);
    console.log(` • Avg Latency:        ${stats.avgDurationMs} ms`);
    console.log(` • Total Bytes:        ${(stats.totalResponseBytes / 1024).toFixed(2)} KB`);
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
}
