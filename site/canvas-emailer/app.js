const $ = selector => document.querySelector(selector);
const authForm = $('#auth-form');
const signedIn = $('#signed-in');
const signOutButton = $('#sign-out');
const authMessage = $('#auth-message');
const dashboardMessage = $('#dashboard-message');
const results = $('#results');
const hoursSelect = $('#hours-ahead');
const sessionKey = 'canvas-emailer-dashboard-session';
const supportedWindows = new Set([24, 72, 168, 336, 720]);

const show = (element, message, error = false) => {
  element.textContent = message;
  element.classList.toggle('error', error);
};

function storeSession(session) {
  if (session?.access_token && session?.refresh_token) {
    session.expires_at ||= Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
  } else sessionStorage.removeItem(sessionKey);
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); }
  catch { storeSession(null); return null; }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function relativeDue(value) {
  const delta = new Date(value).getTime() - Date.now();
  const minutes = Math.round(Math.abs(delta) / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (delta < 0) return hours >= 24 ? `${days}d ${restHours}h overdue` : `${Math.max(1, hours)}h overdue`;
  if (hours >= 24) return `in ${days}d ${restHours}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.max(1, minutes)}m`;
}

function renderList(element, rows, now) {
  element.replaceChildren();
  for (const row of rows) {
    const item = document.createElement('li');
    item.className = `deadline${new Date(row.due_at) < now ? ' overdue' : ''}`;
    const info = document.createElement('div');
    const title = document.createElement(row.canvas_url ? 'a' : 'span');
    title.className = 'deadline-title';
    title.textContent = row.assignment_name || 'Untitled assignment';
    if (row.canvas_url) { title.href = row.canvas_url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
    const course = document.createElement('span');
    course.className = 'deadline-course';
    course.textContent = `${row.course_short_name || row.course_name || 'Canvas course'} · ${row.assignment_type || 'assignment'}`;
    info.append(title, course);
    const meta = document.createElement('span');
    meta.className = 'deadline-meta';
    meta.append(document.createTextNode(formatDate(row.due_at)));
    const relative = document.createElement('em');
    relative.textContent = relativeDue(row.due_at);
    meta.append(relative);
    item.append(info, meta);
    element.append(item);
  }
}

async function initialize() {
  const configResponse = await fetch('./backend-config.json', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Could not load the dashboard configuration.');
  const backend = await configResponse.json();
  const authUrl = `${backend.url}/auth/v1`;
  const dashboardUrl = `${backend.url}/functions/v1/canvas-dashboard`;
  const headers = { apikey: backend.anonKey, 'Content-Type': 'application/json' };

  const callback = new URLSearchParams(location.hash.slice(1));
  if (callback.has('access_token')) {
    storeSession({
      access_token: callback.get('access_token'),
      refresh_token: callback.get('refresh_token'),
      expires_in: Number(callback.get('expires_in') || 3600),
      token_type: callback.get('token_type') || 'bearer'
    });
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  async function currentSession() {
    const session = readSession();
    if (!session) return null;
    if (session.expires_at > Math.floor(Date.now() / 1000) + 45) return session;
    const response = await fetch(`${authUrl}/token?grant_type=refresh_token`, {
      method: 'POST', headers, body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!response.ok) { storeSession(null); return null; }
    storeSession(await response.json());
    return readSession();
  }

  async function loadAssignments() {
    const session = await currentSession();
    authForm.hidden = Boolean(session);
    signedIn.hidden = !session;
    if (!session) {
      results.hidden = true;
      show(dashboardMessage, 'Sign in with your owner email to load assignments.');
      return;
    }
    show(authMessage, 'Signed in. Your assignment list is private to your account.');
    show(dashboardMessage, 'Loading Canvas assignments…');
    dashboardMessage.hidden = false;
    results.hidden = true;
    const hours = Number(hoursSelect.value);
    if (!supportedWindows.has(hours)) throw new Error('Choose a supported deadline window.');
    const response = await fetch(`${dashboardUrl}?hours=${hours}`, {
      headers: { apikey: backend.anonKey, Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load Canvas assignments.');
    const now = new Date();
    const overdue = data.assignments.filter(row => new Date(row.due_at) < now);
    const upcoming = data.assignments.filter(row => new Date(row.due_at) >= now);
    $('#overdue-count').textContent = String(overdue.length);
    $('#upcoming-count').textContent = String(upcoming.length);
    $('#overdue-label').textContent = String(overdue.length);
    $('#upcoming-label').textContent = String(upcoming.length);
    $('#checked-at').textContent = data.lastCheckedAt ? formatDate(data.lastCheckedAt) : 'Not yet';
    renderList($('#overdue-list'), overdue, now);
    renderList($('#upcoming-list'), upcoming, now);
    $('#overdue-section').hidden = overdue.length === 0;
    $('#upcoming-section').hidden = upcoming.length === 0;
    $('#empty-state').hidden = overdue.length + upcoming.length !== 0;
    $('#refresh-time').textContent = `Dashboard refreshed ${formatDate(new Date())}. Data updates when the Canvas automation runs.`;
    results.hidden = false;
    dashboardMessage.hidden = true;
  }

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = authForm.querySelector('button[type="submit"]');
    button.disabled = true;
    show(authMessage, 'Sending sign-in link…');
    try {
      const email = authForm.elements.email.value.trim();
      const redirect = `${location.origin}/court-reserver/`;
      localStorage.setItem('canvas-dashboard-auth-started-at', String(Date.now()));
      const response = await fetch(`${authUrl}/otp?redirect_to=${encodeURIComponent(redirect)}`, {
        method: 'POST', headers, body: JSON.stringify({ email, create_user: false })
      });
      if (!response.ok) throw new Error('Could not send the sign-in link. Check the email address or try again shortly.');
      show(authMessage, 'Check your email and open the secure sign-in link on this device.');
    } catch (error) {
      localStorage.removeItem('canvas-dashboard-auth-started-at');
      show(authMessage, error instanceof Error ? error.message : 'Could not send a sign-in link.', true);
    } finally { button.disabled = false; }
  });

  signOutButton.addEventListener('click', () => {
    storeSession(null);
    results.hidden = true;
    signedIn.hidden = true;
    authForm.hidden = false;
    show(authMessage, 'Signed out.');
    show(dashboardMessage, 'Sign in with your owner email to load assignments.');
  });
  hoursSelect.addEventListener('change', () => loadAssignments().catch(error => show(dashboardMessage, error.message, true)));
  await loadAssignments();
}

initialize().catch(error => show(dashboardMessage, error instanceof Error ? error.message : 'Could not start the dashboard.', true));
