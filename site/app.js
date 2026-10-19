const form = document.querySelector('#settings-form');
const sport = document.querySelector('#sport');
const room = document.querySelector('#badminton-room');
const start = document.querySelector('#start-time');
const end = document.querySelector('#end-time');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const roomField = document.querySelector('#room-field');
const tokenInput = document.querySelector('#github-token');
const saveButton = document.querySelector('#save-button');
const configApiUrl = 'https://api.github.com/repos/Dracula-101/court-reserver/contents/site/config.json';

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

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

async function githubJson(token, options = {}) {
  const response = await fetch(configApiUrl, {
    ...options,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers
    }
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('GitHub rejected this token. Check that it is valid and has Contents: Read and write for court-reserver.');
  }
  if (response.status === 409) throw new Error('Settings changed during this save. Reload the page and try again.');
  if (!response.ok) throw new Error(`GitHub could not save settings (HTTP ${response.status}).`);
  return response.json();
}

for (const control of [sport, room, start]) control.addEventListener('change', refresh);
start.addEventListener('input', refresh);

fetch('./config.json', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('Could not load saved settings');
    return response.json();
  })
  .then(settings => {
    sport.value = settings.sport || 'squash';
    room.value = settings.badmintonRoom || 'any';
    start.value = settings.startTime || '18:00';
    refresh();
  })
  .catch(() => showMessage('Could not load saved settings. Reload the page before saving.', true));

form.addEventListener('submit', async event => {
  event.preventDefault();
  showMessage('');
  if (!refresh()) return showMessage('The time must end before midnight.', true);
  if (location.origin !== 'https://dracula-101.github.io' || !location.pathname.startsWith('/court-reserver/')) {
    return showMessage('Open the published GitHub Pages site to save settings.', true);
  }
  const token = tokenInput.value.trim();
  if (!token) return showMessage('Enter your fine-grained GitHub token to save.', true);
  const settings = { sport: sport.value, startTime: start.value, badmintonRoom: room.value };
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    const current = await githubJson(token);
    if (!current.sha) throw new Error('GitHub did not return the current settings file.');
    await githubJson(token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update court reservation settings',
        content: btoa(JSON.stringify(settings, null, 2) + '\n'),
        sha: current.sha,
        branch: 'main'
      })
    });
    showMessage('Saved to GitHub. The next booking run will use these settings; this page may take a minute to update.');
  } catch (error) {
    showMessage(error instanceof Error ? error.message : 'Could not save settings.', true);
  } finally {
    tokenInput.value = '';
    saveButton.disabled = false;
    saveButton.textContent = 'Save settings';
  }
});

refresh();
