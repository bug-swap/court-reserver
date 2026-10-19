import test from 'node:test';
import assert from 'node:assert/strict';
import { emsTime, endTime, modeForSchedule, requestedRoom, requestedTime, targetDate } from '../src/config.mjs';

test('books tomorrow in Denver across spring DST', () => {
  assert.equal(targetDate(new Date('2026-03-08T07:07:00Z')), '2026-03-09');
  assert.equal(modeForSchedule(new Date('2026-03-08T07:07:00Z')), 'book');
  assert.equal(modeForSchedule(new Date('2026-03-08T06:07:00Z')), 'keepalive');
});

test('books tomorrow in Denver across fall DST', () => {
  assert.equal(targetDate(new Date('2026-11-01T06:07:00Z')), '2026-11-02');
  assert.equal(modeForSchedule(new Date('2026-11-01T06:07:00Z')), 'book');
  assert.equal(modeForSchedule(new Date('2026-11-01T07:07:00Z')), 'book');
});

test('accepts configurable one-hour slots and badminton rooms', () => {
  assert.equal(emsTime(requestedTime('18:30')), '6:30 PM');
  assert.equal(emsTime(endTime('18:30')), '7:30 PM');
  assert.equal(requestedRoom('3B'), '3B');
  assert.throws(() => requestedTime('23:30'));
  assert.throws(() => requestedRoom('3D'));
});
