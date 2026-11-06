import { describe, it } from 'node:test';
import assert from 'node:assert';

import { readBoundedNumber } from '../../src/helpers/env_number.js';

describe('readBoundedNumber', () => {
  it('falls back when the value is absent, blank or not a number', () => {
    assert.strictEqual(readBoundedNumber(undefined, 95), 95);
    assert.strictEqual(readBoundedNumber(null, 95), 95);
    assert.strictEqual(readBoundedNumber('', 95), 95, 'an empty env line must not become 0');
    assert.strictEqual(readBoundedNumber('   ', 95), 95);
    assert.strictEqual(readBoundedNumber('95%', 95), 95, 'a percent suffix must not become NaN');
    assert.strictEqual(readBoundedNumber('abc', 95), 95);
  });

  it('accepts a valid number, trimming whitespace', () => {
    assert.strictEqual(readBoundedNumber('42', 95), 42);
    assert.strictEqual(readBoundedNumber(' 7 ', 95), 7);
    assert.strictEqual(readBoundedNumber('0.5', 1), 0.5);
  });

  it('falls back when the value falls outside the accepted range', () => {
    assert.strictEqual(readBoundedNumber('-5', 1, { min: 0 }), 1);
    assert.strictEqual(readBoundedNumber('150', 95, { min: 1, max: 100 }), 95);
    assert.strictEqual(readBoundedNumber('0', 95, { min: 1, max: 100 }), 95);
  });

  it('truncates integer ranges', () => {
    assert.strictEqual(readBoundedNumber('3.9', 1, { integer: true }), 3);
    assert.strictEqual(readBoundedNumber('-1', 1, { integer: true, min: 0 }), 1);
  });
});
