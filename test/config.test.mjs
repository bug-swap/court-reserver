import test from 'node:test';
import assert from 'node:assert/strict';
import { emsHeadingDate, emsTime, endTime, requestedDate, requestedRoom, requestedTime, targetDate } from '../src/config.mjs';

test('books tomorrow in Denver across spring DST', () => {
  assert.equal(targetDate(new Date('2026-03-08T07:07:00Z')), '2026-03-09');
});

test('books tomorrow in Denver across fall DST', () => {
  assert.equal(targetDate(new Date('2026-11-01T06:07:00Z')), '2026-11-02');
});

test('accepts configurable one-hour slots and badminton rooms', () => {
  assert.equal(emsTime(requestedTime('18:30')), '6:30 PM');
  assert.equal(emsTime(endTime('18:30')), '7:30 PM');
  assert.equal(requestedRoom('3B'), '3B');
  assert.throws(() => requestedTime('23:30'));
  assert.throws(() => requestedRoom('3D'));
});

test('formats dates like the EMS new-booking heading', () => {
  assert.equal(emsHeadingDate('2026-10-20'), 'Tue Oct 20, 2026');
  assert.equal(emsHeadingDate('2026-11-01'), 'Sun Nov 1, 2026');
});

test('explicit booking dates are limited to today and tomorrow in Denver', () => {
  const now = new Date('2026-10-21T03:00:00Z');
  assert.equal(requestedDate('', now), '2026-10-21');
  assert.equal(requestedDate('2026-10-20', now), '2026-10-20');
  assert.equal(requestedDate('2026-10-21', now), '2026-10-21');
  assert.throws(() => requestedDate('2026-10-22', now), /today or tomorrow/);
});
