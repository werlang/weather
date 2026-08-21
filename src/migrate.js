#!/usr/bin/env node
/**
 * SQLite Database Migration Runner & Workflow.
 * Adapted from the node-aec migration architecture for Node.js 26 native SQLite.
 * 
 * Executes versioned SQL migration scripts from the `migrations/` directory in natural
 * numeric order, tracking applied versions inside the `schema_migrations` table.
 * 
 * @module migrate
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sqlite } from './database_driver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../migrations');

/**
 * Removes SQL line comments before splitting a script into ordered,
 * non-empty statements.
 *
 * Removing comments first prevents semicolons inside `--` comments from
 * becoming executable statement fragments.
 *
 * @param {string} sqlContent - Migration SQL source.
 * @returns {string[]} Ordered executable SQL statements.
 */
export function splitSqlStatements(sqlContent) {
    if (!sqlContent || typeof sqlContent !== 'string') return [];

    const uncommentedSql = sqlContent.replace(/--.*$/gm, '');

    return uncommentedSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);
}

/**
 * Runs versioned database migrations synchronously using the SQLite driver.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath] - SQLite database file path.
 * @param {string} [options.migrationsDir] - Directory containing migration SQL files.
 * @param {boolean} [options.silent=false] - Suppress console output.
 * @param {boolean} [options.reuseConnection=false] - Reuse existing connection without closing.
 * @returns {{ applied: string[], total: number }} Migration execution summary.
 */
export function migrateSync(options = {}) {
    const dbPath = options.dbPath || Sqlite.config.path;
    const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
    const silent = options.silent ?? false;

    if (!Sqlite.connected) {
        Sqlite.connect({ path: dbPath });
    } else if (dbPath === ':memory:' && !options.reuseConnection) {
        Sqlite.close();
        Sqlite.connect({ path: ':memory:' });
    }

    // 1. Ensure schema_migrations tracking table exists
    Sqlite.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
    `);

    // 2. Fetch already applied versions using Sqlite query methods
    const rows = Sqlite.find('schema_migrations', {}, { view: ['version'] });
    const appliedVersions = new Set(rows.map(r => Number(r.version)));

    // 3. Read and sort migration files naturally (numeric prefix)
    let files = [];
    try {
        files = fs.readdirSync(migrationsDir);
    } catch {
        files = [];
    }

    const migrationFiles = files
        .filter(f => f.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const applied = [];

    for (const file of migrationFiles) {
        const match = file.match(/^(\d+)_/);
        if (!match) continue;

        const version = parseInt(match[1], 10);
        if (appliedVersions.has(version)) {
            continue;
        }

        const filePath = path.join(migrationsDir, file);
        const sqlContent = fs.readFileSync(filePath, 'utf-8');
        const statements = splitSqlStatements(sqlContent);

        if (!silent) {
            console.log(`Applying migration ${file}...`);
        }

        Sqlite.withTransaction(({ connection }) => {
            for (const statement of statements) {
                Sqlite.exec(statement, { connection });
            }
            Sqlite.insert('schema_migrations', {
                version,
                name: file
            }, { connection });
        });

        if (!silent) {
            console.log(`Successfully applied migration ${file}.`);
        }
        applied.push(file);
    }

    return {
        applied,
        total: migrationFiles.length
    };
}

/**
 * Async wrapper for versioned database migrations.
 *
 * @param {object} [options]
 * @returns {Promise<{ applied: string[], total: number }>}
 */
export async function migrate(options = {}) {
    return migrateSync(options);
}

if (process.argv[1] === __filename) {
    migrate()
        .then(({ applied, total }) => {
            console.log(`✅ Database migration completed successfully. ${applied.length} applied, ${total} total.`);
            Sqlite.close();
        })
        .catch(err => {
            console.error('❌ Migration failed:', err);
            Sqlite.close();
            process.exit(1);
        });
}
