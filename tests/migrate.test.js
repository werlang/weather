import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Sqlite } from '../src/database_driver.js';
import {
    splitSqlStatements,
    migrateSync,
    migrate,
    DEFAULT_MIGRATIONS_DIR
} from '../src/migrate.js';

describe('Database Migration Workflow & SQL Parser', () => {
    describe('splitSqlStatements', () => {
        it('removes line comments and splits statements by semicolons', () => {
            const sql = `
                -- This is a comment at top
                CREATE TABLE foo (id INT); -- inline comment
                -- Another comment
                INSERT INTO foo VALUES (1);
            `;
            const statements = splitSqlStatements(sql);
            assert.deepEqual(statements, [
                'CREATE TABLE foo (id INT)',
                'INSERT INTO foo VALUES (1)'
            ]);
        });

        it('returns empty array for empty or comment-only SQL', () => {
            assert.deepEqual(splitSqlStatements(''), []);
            assert.deepEqual(splitSqlStatements('-- just a comment\n-- another line'), []);
            assert.deepEqual(splitSqlStatements(null), []);
        });

        it('handles semicolons and extra whitespace gracefully', () => {
            const sql = 'SELECT 1; ; ; SELECT 2;';
            const statements = splitSqlStatements(sql);
            assert.deepEqual(statements, ['SELECT 1', 'SELECT 2']);
        });
    });

    describe('migrateSync and migrate execution', () => {
        beforeEach(() => {
            Sqlite.close();
        });

        afterEach(() => {
            Sqlite.close();
        });

        it('applies standard migrations to in-memory database and creates schema_migrations', async () => {
            const result = await migrate({
                dbPath: ':memory:',
                silent: true
            });

            assert.ok(result.applied.includes('001_initial_schema.sql'));
            assert.ok(result.total >= 1);

            // Verify schema_migrations table contents
            const migrations = Sqlite.find('schema_migrations');
            assert.ok(migrations.length >= 1);
            assert.strictEqual(migrations[0].version, 1);
            assert.strictEqual(migrations[0].name, '001_initial_schema.sql');

            // Verify created application tables
            const tables = Sqlite.find('sqlite_master', {
                filter: { type: 'table' },
                view: ['name']
            }).map(t => t.name);

            assert.ok(tables.includes('schema_migrations'));
            assert.ok(tables.includes('fetch_logs'));
            assert.ok(tables.includes('alert_logs'));
            assert.ok(tables.includes('monitor_cycle_logs'));
            assert.ok(tables.includes('system_settings'));
        });

        it('is idempotent: running migrations a second time does not re-apply existing versions', () => {
            const firstRun = migrateSync({
                dbPath: ':memory:',
                silent: true,
                reuseConnection: true
            });
            assert.ok(firstRun.applied.includes('001_initial_schema.sql'));

            const secondRun = migrateSync({
                dbPath: ':memory:',
                silent: true,
                reuseConnection: true
            });
            assert.deepEqual(secondRun.applied, []);
            assert.strictEqual(secondRun.total, firstRun.total);
        });

        it('applies sequential incremental migrations from a custom directory in numeric order', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-migration-test-'));
            try {
                // Migration 001
                fs.writeFileSync(
                    path.join(tmpDir, '001_first.sql'),
                    'CREATE TABLE step_one (id INTEGER PRIMARY KEY); INSERT INTO step_one VALUES (10);'
                );
                // Migration 002
                fs.writeFileSync(
                    path.join(tmpDir, '002_second.sql'),
                    'CREATE TABLE step_two (name TEXT); INSERT INTO step_two VALUES (\'test\');'
                );

                const result = migrateSync({
                    dbPath: ':memory:',
                    migrationsDir: tmpDir,
                    silent: true,
                    reuseConnection: true
                });

                assert.deepEqual(result.applied, ['001_first.sql', '002_second.sql']);
                assert.strictEqual(result.total, 2);

                const stepOne = Sqlite.find('step_one');
                assert.strictEqual(stepOne.length, 1);
                assert.strictEqual(stepOne[0].id, 10);

                const stepTwo = Sqlite.find('step_two');
                assert.strictEqual(stepTwo.length, 1);
                assert.strictEqual(stepTwo[0].name, 'test');

                const records = Sqlite.find('schema_migrations');
                assert.strictEqual(records.length, 2);
                assert.strictEqual(records[0].version, 1);
                assert.strictEqual(records[1].version, 2);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it('rolls back migration transaction when a statement in the migration fails', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-migration-fail-'));
            try {
                // Invalid SQL in 001
                fs.writeFileSync(
                    path.join(tmpDir, '001_failing.sql'),
                    'CREATE TABLE doomed (id INT); INVALID SQL SYNTAX HERE;'
                );

                assert.throws(() => {
                    migrateSync({
                        dbPath: ':memory:',
                        migrationsDir: tmpDir,
                        silent: true,
                        reuseConnection: true
                    });
                });

                // Table doomed should not exist due to rollback
                const doomedTable = Sqlite.findOne('sqlite_master', {
                    filter: { type: 'table', name: 'doomed' }
                });
                assert.strictEqual(doomedTable, null);

                // schema_migrations should have 0 entries
                const records = Sqlite.find('schema_migrations');
                assert.strictEqual(records.length, 0);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
});
