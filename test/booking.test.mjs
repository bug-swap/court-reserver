import assert from 'node:assert/strict';
import test from 'node:test';
import { courtCandidates, squashOpenings } from '../src/booking.mjs';

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

test('squash openings skip booked time and its teardown', () => {
  const rooms = { Buildings: [{
    BuildingHours: [{ BuildingId: 113, Date: '2026-10-21T00:00:00', OpenTime: '1900-01-01T06:00:00', CloseTime: '1900-01-01T23:30:00', ClosedAllDay: false }],
    Rooms: [{ Id: 4673, BuildingID: 113, DisplayText: 'Squash Court', TeardownHours: 0.25 }]
  }] };
  const booking = (start, end, RoomId = 4673) => ({ RoomId, TimeBookingStart: `2026-10-21T${start}:00`, TimeBookingEnd: `2026-10-21T${end}:00` });
  assert.deepEqual(squashOpenings(rooms, { Bookings: [booking('16:00', '17:15'), booking('09:00', '10:15', 943), booking('22:30', '23:30')] }, '2026-10-21'), [
    { start: '06:00', end: '16:00' },
    { start: '17:15', end: '22:30' }
  ]);
  assert.deepEqual(squashOpenings(rooms, { Bookings: [booking('06:00', '22:30')] }, '2026-10-21'), []);
});
