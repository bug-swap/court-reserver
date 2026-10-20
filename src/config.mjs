export const EMS_URL = 'https://ems.colorado.edu/Default.aspx';
export const COURT_URL = 'https://ems.colorado.edu/RoomRequest.aspx?data=ity3Dem%2ByxxGFZTQvNr975iYyqy0fdZA';
export const TIME_ZONE = 'America/Denver';

export function denverParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

export function targetDate(date = new Date()) {
  const { year, month, day } = denverParts(date);
  const target = new Date(Date.UTC(year, month - 1, day + 1, 12));
  return target.toISOString().slice(0, 10);
}

// EMS accepts bookings for today and tomorrow only.
export function requestedDate(value, now = new Date()) {
  if (!value) return targetDate(now);
  const { year, month, day } = denverParts(now);
  const today = new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
  if (![today, targetDate(now)].includes(value)) throw new Error('TARGET_DATE must be today or tomorrow in Denver');
  return value;
}

export function requestedSport(value = 'squash') {
  const sport = value.trim().toLowerCase();
  if (!['squash', 'badminton'].includes(sport)) throw new Error('SPORT must be squash or badminton');
  return sport;
}

export function requestedTime(value = '18:00') {
  if (!/^(?:[01]\d|2[0-2]):[0-5]\d$/.test(value)) throw new Error('Start time must be HH:MM and allow a full hour before midnight');
  return value;
}

export function endTime(startTime) {
  const [hour, minute] = requestedTime(startTime).split(':').map(Number);
  return `${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function emsTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function requestedFallback(value = 'none') {
  if (!['none', 'badminton'].includes(value)) throw new Error('Squash fallback must be none or badminton');
  return value;
}

export function requestedRoom(value = 'any') {
  if (!['any', '3A', '3B', '3C'].includes(value)) throw new Error('Badminton room must be any, 3A, 3B, or 3C');
  return value;
}

// Matches EMS's "New Booking for Tue Oct 20, 2026" heading for a YYYY-MM-DD date.
export function emsHeadingDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  const part = options => value.toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
  return `${part({ weekday: 'short' })} ${part({ month: 'short' })} ${day}, ${year}`;
}
