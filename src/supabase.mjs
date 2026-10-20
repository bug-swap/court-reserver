const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY;

function requireConnection() {
  if (!baseUrl || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  if (!/^https:\/\/[^/]+$/.test(baseUrl)) throw new Error('SUPABASE_URL must be an HTTPS project URL');
}

async function request(path, options = {}) {
  requireConnection();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      ...(key.split('.').length === 3 ? { Authorization: `Bearer ${key}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${options.method || 'GET'} ${path.split('?')[0]} failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function row(table, query) {
  const rows = await request(`${table}?${query}`);
  return rows[0] || null;
}

async function upsert(table, value, conflict) {
  await request(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(value)
  });
}

export async function loadSession() {
  return (await row('court_session', 'select=encrypted_state&id=eq.1'))?.encrypted_state;
}

export async function saveSession(encryptedState) {
  await upsert('court_session', { id: 1, encrypted_state: encryptedState, refreshed_at: new Date().toISOString() }, 'id');
}

// canvas-emailer keeps this Storage object fresh; its CU SSO cookies also sign in to EMS.
export async function loadCanvasSession() {
  requireConnection();
  const response = await fetch(`${baseUrl}/storage/v1/object/canvas-session/session.json`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Supabase GET canvas-session/session.json failed (HTTP ${response.status})`);
  return response.json();
}

export async function loadSettings() {
  return row('court_settings', 'select=sport,start_time,badminton_room&id=eq.1');
}

export async function saveSettings(settings) {
  await upsert('court_settings', {
    id: 1,
    sport: settings.sport,
    start_time: settings.startTime,
    badminton_room: settings.badmintonRoom,
    updated_at: new Date().toISOString()
  }, 'id');
}

export async function hasBooking(date) {
  return Boolean(await row('court_bookings', `select=target_date&target_date=eq.${date}`));
}

export async function saveBooking({ date, sport, startTime, badmintonRoom, confirmation }) {
  await upsert('court_bookings', {
    target_date: date, sport, start_time: startTime,
    badminton_room: badmintonRoom, confirmation: confirmation || null
  }, 'target_date');
}

export async function logRun({ mode, date, outcome, error }) {
  await request('court_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ mode, target_date: date, outcome, error: error || null })
  });
}
