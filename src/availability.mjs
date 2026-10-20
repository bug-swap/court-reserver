// Pure EMS availability math, shared by the Playwright runner and the court-settings Edge Function.

export const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const clock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

function courtDay(roomsData, date, roomName) {
  const building = roomsData.Buildings.find(b => b.Rooms.some(r => r.DisplayText.trim() === roomName));
  const room = building?.Rooms.find(r => r.DisplayText.trim() === roomName);
  const hours = building?.BuildingHours.find(h => h.BuildingId === room?.BuildingID && h.Date.startsWith(date));
  if (!room || !hours) throw new Error(`EMS did not return ${roomName} hours for ${date}`);
  return { room, hours };
}

// Free stretches of a court long enough for a 60-minute booking plus EMS teardown.
export function courtOpenings(roomsData, bookingsData, date, roomName) {
  const { room, hours } = courtDay(roomsData, date, roomName);
  if (hours.ClosedAllDay) return [];
  const close = minutes(hours.CloseTime.slice(11));
  const busy = bookingsData.Bookings
    .filter(b => b.RoomId === room.Id && b.TimeBookingStart.startsWith(date))
    .map(b => [minutes(b.TimeBookingStart.slice(11)), b.TimeBookingEnd.startsWith(date) ? minutes(b.TimeBookingEnd.slice(11)) : 24 * 60])
    .sort((a, b) => a[0] - b[0]);
  const needed = 60 + room.TeardownHours * 60;
  const openings = [];
  let free = minutes(hours.OpenTime.slice(11));
  for (const [start, end] of [...busy, [close, close]]) {
    if (start - free >= needed) openings.push({ start: clock(free), end: clock(start), lastStart: clock(start - needed) });
    free = Math.max(free, end);
  }
  return openings;
}

export function squashOpenings(roomsData, bookingsData, date) {
  return courtOpenings(roomsData, bookingsData, date, 'Squash Court');
}

// Drops the part of each opening that has already started, rounded up to EMS's 15-minute steps.
export function clipOpenings(openings, notBefore = '00:00') {
  const earliest = Math.ceil(minutes(notBefore) / 15) * 15;
  return openings
    .map(opening => ({ ...opening, start: clock(Math.max(minutes(opening.start), earliest)) }))
    .filter(opening => minutes(opening.start) <= minutes(opening.lastStart));
}

export const SLOT_COURTS = [
  { sport: 'squash', room: null, name: 'Squash Court' },
  ...['3A', '3B', '3C'].map(room => ({ sport: 'badminton', room, name: `Badminton_Pickleball ${room}` }))
];

// Each court's opening hours and free windows from EMS's room and booking search data.
export function courtAvailability(roomsData, bookingsData, date, notBefore) {
  return SLOT_COURTS.map(court => {
    const { hours } = courtDay(roomsData, date, court.name);
    return {
      sport: court.sport,
      room: court.room,
      open: hours.ClosedAllDay ? null : hours.OpenTime.slice(11, 16),
      close: hours.ClosedAllDay ? null : hours.CloseTime.slice(11, 16),
      openings: clipOpenings(courtOpenings(roomsData, bookingsData, date, court.name), notBefore)
    };
  });
}
