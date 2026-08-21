/**
 * Database module entry point.
 * Exports SQLite driver, error types, and log database helpers.
 * 
 * @module database
 */

export { Sqlite, DatabaseError } from './driver.js';
export {
    DEFAULT_DB_PATH,
    SCHEMA_SQL,
    getDatabase,
    extractEndpoint,
    logFetch,
    getRecentFetchLogs,
    getFetchStats,
    closeDatabase
} from './log_database.js';
