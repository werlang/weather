import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Sqlite, DatabaseError } from '../database/driver.js';

describe('Sqlite Database Driver (Adapted from node-aec)', () => {
    beforeEach(() => {
        Sqlite.close();
        Sqlite.connect({ path: ':memory:' });
        Sqlite.exec(`
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                quantity INTEGER DEFAULT 0,
                price REAL DEFAULT 0.0,
                metadata TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `);
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('connects and passes ping check', () => {
        assert.strictEqual(Sqlite.connected, true);
        assert.strictEqual(Sqlite.ping(), true);
    });

    it('inserts a single row with RETURNING *', () => {
        const [item] = Sqlite.insert('items', {
            code: 'ITM-001',
            name: 'Thermometer',
            quantity: 10,
            price: 25.50
        });

        assert.ok(item);
        assert.strictEqual(typeof item.id, 'number');
        assert.strictEqual(item.insertId, item.id);
        assert.strictEqual(item.code, 'ITM-001');
        assert.strictEqual(item.name, 'Thermometer');
        assert.strictEqual(item.quantity, 10);
        assert.strictEqual(item.price, 25.50);
    });

    it('inserts multiple rows in batch', () => {
        const rows = Sqlite.insert('items', [
            { code: 'A1', name: 'Sensor A', quantity: 5 },
            { code: 'B2', name: 'Sensor B', quantity: 8 }
        ]);

        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].code, 'A1');
        assert.strictEqual(rows[1].code, 'B2');
    });

    it('finds rows using filters, view projection, sorting, and paging', () => {
        Sqlite.insert('items', [
            { code: 'C1', name: 'Pluviometer 1', quantity: 20, price: 100 },
            { code: 'C2', name: 'Pluviometer 2', quantity: 30, price: 200 },
            { code: 'C3', name: 'Anemometer', quantity: 5, price: 300 }
        ]);

        const pluviometers = Sqlite.find('items', {
            filter: { name: Sqlite.like('Pluviometer') },
            view: ['id', 'code', 'name', 'price'],
            opt: { order: { price: -1 } }
        });

        assert.strictEqual(pluviometers.length, 2);
        assert.strictEqual(pluviometers[0].code, 'C2');
        assert.strictEqual(pluviometers[1].code, 'C1');
        assert.strictEqual(pluviometers[0].quantity, undefined); // view filtered out quantity
    });

    it('findOne returns a single matching record or null', () => {
        Sqlite.insert('items', { code: 'UNIQ', name: 'Barometer' });

        const found = Sqlite.findOne('items', { filter: { code: 'UNIQ' } });
        assert.ok(found);
        assert.strictEqual(found.name, 'Barometer');

        const notFound = Sqlite.findOne('items', { filter: { code: 'NONEXISTENT' } });
        assert.strictEqual(notFound, null);
    });

    it('get returns a record by id or throws DatabaseError (404) if missing', () => {
        const [created] = Sqlite.insert('items', { code: 'GET1', name: 'Get Test' });
        const fetched = Sqlite.get('items', created.id);
        assert.strictEqual(fetched.code, 'GET1');

        assert.throws(() => {
            Sqlite.get('items', 99999);
        }, (err) => {
            return err instanceof DatabaseError && err.statusCode === 404 && err.code === 'RECORD_NOT_FOUND';
        });
    });

    it('updates rows by id and supports inc/dec operators', () => {
        const [item] = Sqlite.insert('items', { code: 'UPD1', name: 'Initial', quantity: 10 });

        const [updated] = Sqlite.update('items', {
            name: 'Updated Name',
            quantity: { inc: 5 }
        }, item.id);

        assert.strictEqual(updated.name, 'Updated Name');
        assert.strictEqual(updated.quantity, 15);

        const [decremented] = Sqlite.update('items', {
            quantity: { dec: 3 }
        }, item.id);
        assert.strictEqual(decremented.quantity, 12);
    });

    it('upserts a row on conflict target', () => {
        Sqlite.insert('items', { code: 'UPS1', name: 'First Version', quantity: 1 });

        const [upserted] = Sqlite.upsert('items', {
            code: 'UPS1',
            name: 'Second Version',
            quantity: 99
        }, {
            conflictFields: ['code'],
            updateFields: ['name', 'quantity']
        });

        assert.ok(upserted);
        assert.strictEqual(upserted.code, 'UPS1');
        assert.strictEqual(upserted.name, 'Second Version');
        assert.strictEqual(upserted.quantity, 99);
    });

    it('deletes rows by id or filter clause', () => {
        const [item1] = Sqlite.insert('items', { code: 'DEL1', name: 'Del 1' });
        const [item2] = Sqlite.insert('items', { code: 'DEL2', name: 'Del 2' });

        Sqlite.delete('items', item1.id);
        assert.strictEqual(Sqlite.findOne('items', { filter: { id: item1.id } }), null);

        Sqlite.delete('items', { code: 'DEL2' });
        assert.strictEqual(Sqlite.findOne('items', { filter: { id: item2.id } }), null);
    });

    it('supports advanced WHERE operators (in, between, comparisons, not)', () => {
        Sqlite.insert('items', [
            { code: 'OP1', name: 'Item 1', quantity: 10 },
            { code: 'OP2', name: 'Item 2', quantity: 20 },
            { code: 'OP3', name: 'Item 3', quantity: 30 },
            { code: 'OP4', name: 'Item 4', quantity: 40 }
        ]);

        const inItems = Sqlite.find('items', { filter: { code: ['OP1', 'OP3'] } });
        assert.strictEqual(inItems.length, 2);

        const betweenItems = Sqlite.find('items', { filter: { quantity: Sqlite.between(15, 35) } });
        assert.strictEqual(betweenItems.length, 2);

        const gtItems = Sqlite.find('items', { filter: { quantity: Sqlite.gt(20) } });
        assert.strictEqual(gtItems.length, 2);

        const neItems = Sqlite.find('items', { filter: { code: Sqlite.ne('OP1') } });
        assert.strictEqual(neItems.length, 3);
    });

    it('handles atomic transactions with commit and rollback', () => {
        // Successful transaction
        Sqlite.withTransaction(() => {
            Sqlite.insert('items', { code: 'TX1', name: 'Tx 1' });
            Sqlite.insert('items', { code: 'TX2', name: 'Tx 2' });
        });

        assert.strictEqual(Sqlite.find('items', { filter: { code: ['TX1', 'TX2'] } }).length, 2);

        // Rolled back transaction on error
        assert.throws(() => {
            Sqlite.withTransaction(() => {
                Sqlite.insert('items', { code: 'TX3', name: 'Tx 3' });
                throw new Error('Simulated failure during transaction');
            });
        });

        assert.strictEqual(Sqlite.findOne('items', { filter: { code: 'TX3' } }), null);
    });
});
