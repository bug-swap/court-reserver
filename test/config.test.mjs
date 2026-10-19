import test from 'node:test';
import assert from 'node:assert/strict';
import { modeForSchedule, targetDate } from '../src/config.mjs';

test('books two Denver calendar days ahead across spring DST', () => {
  assert.equal(targetDate(new Date('2026-03-08T07:07:00Z')), '2026-03-10');
  assert.equal(modeForSchedule(new Date('2026-03-08T07:07:00Z')), 'book');
  assert.equal(modeForSchedule(new Date('2026-03-08T06:07:00Z')), 'keepalive');
});

test('books two Denver calendar days ahead across fall DST', () => {
  assert.equal(targetDate(new Date('2026-11-01T06:07:00Z')), '2026-11-03');
  assert.equal(modeForSchedule(new Date('2026-11-01T06:07:00Z')), 'book');
  assert.equal(modeForSchedule(new Date('2026-11-01T07:07:00Z')), 'keepalive');
});
