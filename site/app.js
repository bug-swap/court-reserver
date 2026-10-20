const form = document.querySelector('#settings-form');
const sport = document.querySelector('#sport');
const room = document.querySelector('#badminton-room');
const start = document.querySelector('#start-time');
const end = document.querySelector('#end-time');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const roomField = document.querySelector('#room-field');
const saveButton = document.querySelector('#save-button');
const activeList = document.querySelector('#active-reservations');
const pastList = document.querySelector('#past-reservations');

const timeLabel = value => {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

function refresh() {
  roomField.hidden = sport.value !== 'badminton';
  const valid = /^(?:[01]\d|2[0-2]):[0-5]\d$/.test(start.value);
  if (valid) {
    const [hour, minute] = start.value.split(':').map(Number);
    end.value = timeLabel(`${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  } else {
    end.value = 'Choose an earlier start';
  }
  const court = sport.value === 'squash'
    ? 'Squash Court'
    : room.value === 'any' ? 'any available badminton court' : `Badminton court ${room.value}`;
  summary.textContent = valid
    ? `Every day: request ${court} for tomorrow, ${timeLabel(start.value)}–${end.value} Mountain time.`
    : 'Choose a start time that leaves one full hour before midnight.';
  return valid;
}

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle('error', isError);
}

function denverToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}

function renderList(list, reservations, emptyText) {
  list.replaceChildren(...(reservations.length ? reservations.map(reservation => {
    const item = document.createElement('li');
    const when = document.createElement('span');
    const court = document.createElement('span');
    const day = new Date(`${reservation.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const [hour, minute] = reservation.startTime.split(':').map(Number);
    when.className = 'when';
    when.textContent = `${day}, ${timeLabel(reservation.startTime)}–${timeLabel(`${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)}`;
    court.className = 'court';
    court.textContent = reservation.sport === 'squash'
      ? 'Squash Court'
      : reservation.badmintonRoom === 'any' ? 'Badminton' : `Badminton court ${reservation.badmintonRoom}`;
    item.append(when, court);
    return item;
  }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: emptyText })]));
}

function renderReservations(reservations = []) {
  const today = denverToday();
  renderList(activeList, reservations.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date)), 'No upcoming reservations.');
  renderList(pastList, reservations.filter(r => r.date < today), 'No past reservations yet.');
}

async function initialize() {
  const configResponse = await fetch('./backend-config.json', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Could not load the settings service configuration.');
  const backend = await configResponse.json();
  const settingsUrl = `${backend.url}/functions/v1/court-settings`;
  const headers = { apikey: backend.anonKey, 'Content-Type': 'application/json' };

  async function loadSettings() {
    const response = await fetch(settingsUrl, { headers: { apikey: backend.anonKey }, cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load saved settings from Supabase.');
    const settings = await response.json();
    sport.value = settings.sport || 'squash';
    room.value = settings.badmintonRoom || 'any';
    start.value = settings.startTime || '18:00';
    refresh();
    renderReservations(settings.reservations);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(message, '');
    if (!refresh()) return showMessage(message, 'The time must end before midnight.', true);
    const settings = { sport: sport.value, startTime: start.value, badmintonRoom: room.value };
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const response = await fetch(settingsUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(settings)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save settings.');
      showMessage(message, 'Saved to Supabase. The next booking run will use these settings.');
    } catch (error) {
      showMessage(message, error instanceof Error ? error.message : 'Could not save settings.', true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save settings';
    }
  });

  await loadSettings();
}

for (const control of [sport, room, start]) control.addEventListener('change', refresh);
start.addEventListener('input', refresh);

initialize().catch(error => showMessage(message, error instanceof Error ? error.message : 'Could not start the settings page.', true));
refresh();
