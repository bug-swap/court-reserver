const form = document.querySelector('#settings-form');
const authForm = document.querySelector('#auth-form');
const sport = document.querySelector('#sport');
const room = document.querySelector('#badminton-room');
const start = document.querySelector('#start-time');
const end = document.querySelector('#end-time');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const authMessage = document.querySelector('#auth-message');
const roomField = document.querySelector('#room-field');
const saveButton = document.querySelector('#save-button');
const signOutButton = document.querySelector('#sign-out');
const sessionStorageKey = 'court-settings-session';

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

function storeSession(session) {
  if (session?.access_token && session?.refresh_token) {
    session.expires_at = session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(sessionStorageKey);
  }
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(sessionStorageKey) || 'null');
  } catch {
    storeSession(null);
    return null;
  }
}

async function initialize() {
  const configResponse = await fetch('./backend-config.json', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Could not load the settings service configuration.');
  const backend = await configResponse.json();
  const authUrl = `${backend.url}/auth/v1`;
  const settingsUrl = `${backend.url}/functions/v1/court-settings`;
  const headers = { apikey: backend.anonKey, 'Content-Type': 'application/json' };

  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('access_token')) {
    storeSession({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      expires_in: Number(params.get('expires_in') || 3600),
      token_type: params.get('token_type') || 'bearer'
    });
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  async function currentSession() {
    const session = readSession();
    if (!session) return null;
    if (session.expires_at > Math.floor(Date.now() / 1000) + 30) return session;
    const response = await fetch(`${authUrl}/token?grant_type=refresh_token`, {
      method: 'POST', headers,
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!response.ok) {
      storeSession(null);
      return null;
    }
    const renewed = await response.json();
    storeSession(renewed);
    return readSession();
  }

  async function updateAuthState() {
    const session = await currentSession();
    authForm.hidden = Boolean(session);
    signOutButton.hidden = !session;
    if (session) showMessage(authMessage, 'Signed in. You can save your reservation settings.');
    return session;
  }

  async function loadSettings() {
    const response = await fetch(settingsUrl, { headers: { apikey: backend.anonKey }, cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load saved settings from Supabase.');
    const settings = await response.json();
    sport.value = settings.sport || 'squash';
    room.value = settings.badmintonRoom || 'any';
    start.value = settings.startTime || '18:00';
    refresh();
  }

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(authMessage, 'Sending sign-in link…');
    const button = authForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const redirect = `${location.origin}${location.pathname}`;
      const response = await fetch(`${authUrl}/otp?redirect_to=${encodeURIComponent(redirect)}`, {
        method: 'POST', headers,
        body: JSON.stringify({ email: authForm.elements.email.value.trim(), create_user: true })
      });
      if (!response.ok) throw new Error('Supabase could not send the link. Check the email address or try again shortly.');
      showMessage(authMessage, 'Check your email and open the sign-in link on this device.');
    } catch (error) {
      showMessage(authMessage, error instanceof Error ? error.message : 'Could not send the sign-in link.', true);
    } finally {
      button.disabled = false;
    }
  });

  signOutButton.addEventListener('click', () => {
    storeSession(null);
    showMessage(authMessage, 'Signed out.');
    void updateAuthState();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(message, '');
    if (!refresh()) return showMessage(message, 'The time must end before midnight.', true);
    const session = await currentSession();
    if (!session) return showMessage(message, 'Sign in with the reservation owner’s email before saving.', true);
    const settings = { sport: sport.value, startTime: start.value, badmintonRoom: room.value };
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const response = await fetch(settingsUrl, {
        method: 'PATCH',
        headers: { ...headers, Authorization: `Bearer ${session.access_token}` },
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
  await updateAuthState();
}

for (const control of [sport, room, start]) control.addEventListener('change', refresh);
start.addEventListener('input', refresh);

initialize().catch(error => showMessage(message, error instanceof Error ? error.message : 'Could not start the settings page.', true));
refresh();
