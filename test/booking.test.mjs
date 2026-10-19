import assert from 'node:assert/strict';
import test from 'node:test';
import { courtCandidates } from '../src/booking.mjs';

test('squash fallback tries badminton courts in configured priority order', () => {
  assert.deepEqual(courtCandidates('squash', 'any'), [
    { sport: 'squash', room: null, name: 'Squash Court' },
    { sport: 'badminton', room: '3C', name: 'Badminton_Pickleball 3C' },
    { sport: 'badminton', room: '3A', name: 'Badminton_Pickleball 3A' },
    { sport: 'badminton', room: '3B', name: 'Badminton_Pickleball 3B' }
  ]);
});

test('badminton settings retain their selected room behavior without squash fallback', () => {
  assert.deepEqual(courtCandidates('badminton', 'any').map(court => court.room), ['3A', '3B', '3C']);
  assert.deepEqual(courtCandidates('badminton', '3B').map(court => court.room), ['3B']);
});
