import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never touch the developer's real database file.
process.env.DB_PATH = ':memory:';

import { Sqlite } from '../../src/helpers/database_driver.js';
import { getDatabase } from '../../src/model/log_database.js';
import {
    addSmsSubscriber,
    countSmsSubscribers,
    getSmsNumbers,
    listSmsSubscribers,
    removeSmsSubscriber
} from '../../src/model/sms_subscriber_store.js';

describe('SMS subscriber store', () => {
    beforeEach(() => {
        Sqlite.close();
        getDatabase(':memory:');
        Sqlite.exec('DELETE FROM sms_subscribers');
    });

    afterEach(() => {
        Sqlite.close();
    });

    it('adds a subscriber with a normalized E.164 number', () => {
        const result = addSmsSubscriber('(43) 99999-8888', { label: 'Defesa Civil local', addedBy: '123' });
        assert.equal(result.ok, true);
        assert.equal(result.phone, '5543999998888');

        const rows = listSmsSubscribers();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].phone, '5543999998888');
        assert.equal(rows[0].label, 'Defesa Civil local');
        assert.equal(rows[0].addedBy, '123');
        assert.ok(rows[0].createdAt);
    });

    it('is idempotent for a duplicate number', () => {
        assert.equal(addSmsSubscriber('43999998888').ok, true);
        const second = addSmsSubscriber('5543999998888');
        assert.equal(second.ok, false);
        assert.equal(second.reason, 'already_present');
        assert.equal(countSmsSubscribers(), 1);
    });

    it('treats differently formatted twins of one number as the same entry', () => {
        addSmsSubscriber('+55 43 99999-8888');
        const result = addSmsSubscriber('43999998888');
        assert.equal(result.reason, 'already_present');
        assert.equal(countSmsSubscribers(), 1);
    });

    it('rejects malformed numbers without writing a row', () => {
        const result = addSmsSubscriber('not-a-phone');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid_phone');
        assert.equal(countSmsSubscribers(), 0);
    });

    it('removes a subscriber by any accepted format of the number', () => {
        addSmsSubscriber('43999998888');
        assert.equal(removeSmsSubscriber('5543999998888'), true);
        assert.equal(countSmsSubscribers(), 0);
        assert.equal(removeSmsSubscriber('5543999998888'), false);
    });

    it('returns sorted normalized numbers for dispatch', () => {
        addSmsSubscriber('51988887777', { label: 'B' });
        addSmsSubscriber('43999998888', { label: 'A' });
        addSmsSubscriber('bad-input');

        assert.deepEqual(getSmsNumbers(), ['5543999998888', '5551988887777']);
    });

    it('returns an empty list when the store is unusable', () => {
        const broken = { find() { throw new Error('boom'); }, findOne() { throw new Error('boom'); } };
        assert.deepEqual(listSmsSubscribers(broken), []);
        assert.equal(countSmsSubscribers(broken), 0);
        assert.deepEqual(getSmsNumbers(broken), []);
    });
});
