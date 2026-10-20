const form = document.querySelector('#settings-form');
const sport = document.querySelector('#sport');
const room = document.querySelector('#badminton-room');
const start = document.querySelector('#start-time');
const end = document.querySelector('#end-time');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const roomField = document.querySelector('#room-field');
const fallback = document.querySelector('#squash-fallback');
const fallbackField = document.querySelector('#fallback-field');
const saveButton = document.querySelector('#save-button');
const activeList = document.querySelector('#active-reservations');
const pastList = document.querySelector('#past-reservations');
const slotDate = document.querySelector('#slot-date');
const getSlotsButton = document.querySelector('#get-slots');
const slotsMessage = document.querySelector('#slots-message');
const slotList = document.querySelector('#slot-list');
const slotForm = document.querySelector('#slot-form');
const slotCourt = document.querySelector('#slot-court');
const slotStart = document.querySelector('#slot-start');
const slotReview = document.querySelector('#slot-review');
const slotConfirm = document.querySelector('#slot-confirm');
const slotConfirmText = document.querySelector('#slot-confirm-text');
const slotBookButton = document.querySelector('#slot-book');
const slotCancelButton = document.querySelector('#slot-cancel');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const timeLabel = value => {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

function refresh() {
  roomField.hidden = sport.value !== 'badminton';
  fallbackField.hidden = sport.value !== 'squash';
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
    ? `Every day: request ${court} for tomorrow, ${timeLabel(start.value)}–${end.value} Mountain time.${sport.value === 'squash' ? fallback.value === 'badminton' ? ' If squash is taken, book the closest open squash time within 3 hours, otherwise a free badminton court at this time.' : ' If squash is taken, nothing is booked.' : ''}`
    : 'Choose a start time that leaves one full hour before midnight.';
  return valid;
}

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle('error', isError);
}

function denverNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function dayLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toClock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

function courtLabel(court) {
  return court.sport === 'squash' ? 'Squash Court' : `Badminton court ${court.room}`;
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
    court.textContent = reservation.status && reservation.status !== 'Confirmed'
      ? `${reservation.court} · ${reservation.status}`
      : reservation.court;
    item.append(when, court);
    return item;
  }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: emptyText })]));
}

function renderReservations(reservations = []) {
  const now = denverNow();
  const startsAt = r => `${r.date}T${r.startTime}`;
  renderList(activeList, reservations.filter(r => startsAt(r) >= now).sort((a, b) => startsAt(a).localeCompare(startsAt(b))), 'No upcoming reservations.');
  renderList(pastList, reservations.filter(r => startsAt(r) < now).sort((a, b) => startsAt(b).localeCompare(startsAt(a))), 'No past reservations yet.');
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
    fallback.value = settings.squashFallback || 'none';
    start.value = settings.startTime || '18:00';
    refresh();
    renderReservations(settings.reservations);
  }

  let availability = { courts: null };

  async function getJson(query) {
    const response = await fetch(`${settingsUrl}?${query}`, { headers: { apikey: backend.anonKey }, cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not reach the settings service.');
    return result;
  }

  async function startRun(body) {
    const response = await fetch(settingsUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not start the EMS run.');
    return Date.now();
  }

  function timeline(court) {
    const bar = document.createElement('div');
    const axis = document.createElement('div');
    bar.className = 'timeline';
    axis.className = 'axis';
    const open = toMinutes(court.open);
    const span = toMinutes(court.close) - open;
    for (const opening of court.openings) {
      const free = document.createElement('div');
      free.className = 'free';
      free.style.left = `${(toMinutes(opening.start) - open) / span * 100}%`;
      free.style.width = `${(toMinutes(opening.end) - toMinutes(opening.start)) / span * 100}%`;
      free.title = `Free ${timeLabel(opening.start)}–${timeLabel(opening.end)}`;
      bar.append(free);
    }
    axis.append(...[court.open, toClock(open + Math.round(span / 2 / 60) * 60), court.close].map(time => Object.assign(document.createElement('span'), { textContent: timeLabel(time) })));
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', court.openings.length
      ? `Free ${court.openings.map(o => `${timeLabel(o.start)} to ${timeLabel(o.end)}`).join(', ')}`
      : 'No free time');
    return [bar, axis];
  }

  function startOptions(court) {
    const options = [];
    for (const opening of court.openings) {
      for (let time = toMinutes(opening.start); time <= toMinutes(opening.lastStart); time += 15) options.push(toClock(time));
    }
    return options;
  }

  function showConfirm(visible) {
    slotConfirm.hidden = !visible;
    slotReview.hidden = visible;
  }

  function fillStartTimes() {
    const court = availability.courts?.[Number(slotCourt.value)];
    const options = court ? startOptions(court) : [];
    const preferred = toMinutes(start.value || '18:00');
    const closest = options.reduce((best, time) => best === null || Math.abs(toMinutes(time) - preferred) < Math.abs(toMinutes(best) - preferred) ? time : best, null);
    slotStart.replaceChildren(...options.map(time => {
      const [hour, minute] = time.split(':').map(Number);
      return new Option(`${timeLabel(time)}–${timeLabel(toClock(hour * 60 + minute + 60))}`, time, false, time === closest);
    }));
    slotReview.disabled = !options.length;
    showConfirm(false);
  }

  function renderAvailability(result) {
    availability = result;
    slotConfirm.hidden = true;
    const usable = Array.isArray(result.courts) && result.courts.every(court => Array.isArray(court.openings));
    if (!usable) {
      slotList.replaceChildren();
      slotForm.hidden = true;
      return showMessage(slotsMessage, 'Free times for this day have not been checked yet. Use Check EMS now.');
    }
    const checkedAt = new Date(result.fetchedAt);
    const ageMinutes = Math.round((Date.now() - checkedAt) / 60000);
    const checked = checkedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    showMessage(slotsMessage, ageMinutes > 30
      ? `Checked at ${checked}, ${ageMinutes >= 120 ? `${Math.round(ageMinutes / 60)} hours` : `${ageMinutes} minutes`} ago. Courts may have been booked since; check EMS again for current times.`
      : `Checked at ${checked}. Green is free; booking re-checks EMS.`);
    slotsMessage.classList.toggle('stale', ageMinutes > 30);
    const legend = Object.assign(document.createElement('div'), { className: 'legend' });
    legend.append(Object.assign(document.createElement('span'), { className: 'l-free', textContent: 'Free' }), Object.assign(document.createElement('span'), { className: 'l-busy', textContent: 'Booked or closed' }));
    slotList.replaceChildren(legend, ...result.courts.map(court => {
      const group = document.createElement('div');
      const heading = Object.assign(document.createElement('h3'), { textContent: courtLabel(court) });
      const windows = Object.assign(document.createElement('p'), { className: 'windows' });
      windows.textContent = !court.open
        ? 'Closed all day.'
        : court.openings.length
          ? court.openings.map(o => `${timeLabel(o.start)}–${timeLabel(o.end)} (start by ${timeLabel(o.lastStart)})`).join(' · ')
          : 'No free hour left.';
      group.className = 'slot-group';
      group.append(heading, ...(court.open ? timeline(court) : []), windows);
      return group;
    }));
    const previous = slotCourt.value;
    slotCourt.replaceChildren(...result.courts.map((court, index) => new Option(`${courtLabel(court)}${court.openings.length ? '' : ' (full)'}`, String(index))));
    const preferredIndex = result.courts.findIndex(court => court.sport === sport.value && court.openings.length);
    slotCourt.value = previous && result.courts[Number(previous)] ? previous : String(Math.max(preferredIndex, 0));
    fillStartTimes();
    slotForm.hidden = false;
  }

  async function showSavedAvailability() {
    try {
      renderAvailability(await getJson(`slots=${slotDate.value}`));
    } catch (error) {
      showMessage(slotsMessage, error instanceof Error ? error.message : 'Could not load free times.', true);
    }
  }

  function setBusy(busy) {
    for (const control of [getSlotsButton, slotBookButton, slotReview, slotDate, slotCourt, slotStart]) control.disabled = busy;
  }

  // GitHub Actions needs a minute or two to start a browser and reach EMS.
  async function waitFor(check, waitingText) {
    for (let attempt = 0; attempt < 60; attempt++) {
      showMessage(slotsMessage, `${waitingText} (${Math.floor(attempt * 5 / 60)}:${String(attempt * 5 % 60).padStart(2, '0')})`);
      const result = await check();
      if (result) return result;
      await sleep(5000);
    }
    throw new Error('EMS did not answer within 5 minutes. Check the automation runs on GitHub.');
  }

  getSlotsButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      const date = slotDate.value;
      const requestedAt = await startRun({ action: 'slots', date });
      const result = await waitFor(async () => {
        const saved = await getJson(`slots=${date}`);
        if (saved.fetchedAt && Date.parse(saved.fetchedAt) > requestedAt - 10000) return saved;
        const [run] = await getJson('runs');
        if (run?.mode === 'slots' && run.date === date && run.outcome === 'failed' && Date.parse(run.finishedAt) > requestedAt) {
          throw new Error(`EMS check failed: ${run.error}`);
        }
        return null;
      }, 'Checking EMS for free times…');
      renderAvailability(result);
    } catch (error) {
      showMessage(slotsMessage, error instanceof Error ? error.message : 'Could not check EMS.', true);
    } finally {
      setBusy(false);
    }
  });

  slotCourt.addEventListener('change', fillStartTimes);
  slotStart.addEventListener('change', () => showConfirm(false));

  slotForm.addEventListener('submit', event => {
    event.preventDefault();
    const court = availability.courts[Number(slotCourt.value)];
    slotConfirmText.textContent = `Book ${courtLabel(court)} on ${dayLabel(slotDate.value)}, ${slotStart.selectedOptions[0].textContent} Mountain time?`;
    showConfirm(true);
  });

  slotCancelButton.addEventListener('click', () => showConfirm(false));

  slotBookButton.addEventListener('click', async () => {
    const date = slotDate.value;
    const court = availability.courts[Number(slotCourt.value)];
    const time = slotStart.value;
    setBusy(true);
    try {
      const requestedAt = await startRun({ action: 'book', date, sport: court.sport, startTime: time, badmintonRoom: court.room || 'any' });
      showConfirm(false);
      const run = await waitFor(async () => {
        const runs = await getJson('runs');
        return runs.find(r => r.mode === 'book' && r.date === date && Date.parse(r.finishedAt) > requestedAt) || null;
      }, `Booking ${courtLabel(court)} at ${timeLabel(time)}…`);
      await loadSettings();
      await showSavedAvailability();
      if (run.outcome === 'confirmed') showMessage(slotsMessage, `Booked ${courtLabel(court)} on ${dayLabel(date)} at ${timeLabel(time)}. A confirmation email is on its way.`);
      else if (run.outcome === 'already_booked') showMessage(slotsMessage, `A reservation for ${dayLabel(date)} is already recorded, so nothing new was booked.`, true);
      else showMessage(slotsMessage, `Booking failed, likely because the time was taken since the last check: ${run.error || run.outcome}. The free times above are now current.`, true);
    } catch (error) {
      showMessage(slotsMessage, error instanceof Error ? error.message : 'Could not book.', true);
    } finally {
      setBusy(false);
    }
  });

  const [, today] = denverNow().match(/^(\d{4}-\d{2}-\d{2})/);
  const [year, month, day] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
  slotDate.replaceChildren(
    new Option(`Tomorrow, ${dayLabel(tomorrow)}`, tomorrow),
    new Option(`Today, ${dayLabel(today)}`, today)
  );
  slotDate.addEventListener('change', showSavedAvailability);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(message, '');
    if (!refresh()) return showMessage(message, 'The time must end before midnight.', true);
    const settings = { sport: sport.value, startTime: start.value, badmintonRoom: room.value, squashFallback: fallback.value };
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
  await showSavedAvailability();
}

for (const control of [sport, room, start, fallback]) control.addEventListener('change', refresh);
start.addEventListener('input', refresh);

initialize().catch(error => showMessage(message, error instanceof Error ? error.message : 'Could not start the settings page.', true));
refresh();
