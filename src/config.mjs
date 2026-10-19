export const EMS_URL = 'https://ems.colorado.edu/';
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
  const target = new Date(Date.UTC(year, month - 1, day + 2, 12));
  return target.toISOString().slice(0, 10);
}

export function modeForSchedule(date = new Date()) {
  const { hour, minute } = denverParts(date);
  return hour === 0 && minute < 50 ? 'book' : 'keepalive';
}

export function requestedSport(value = 'squash') {
  const sport = value.trim().toLowerCase();
  if (!['squash', 'badminton'].includes(sport)) throw new Error('SPORT must be squash or badminton');
  return sport;
}

export function requestedTime(value = '18:00') {
  if (!['06:00', '18:00'].includes(value)) throw new Error('START_TIME must be 06:00 or 18:00');
  return value;
}
