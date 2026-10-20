const projectUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
const serviceKey = Deno.env.get('COURT_SUPABASE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const siteOrigin = 'https://bug-swap.github.io';
// Fine-grained token limited to Actions: write on bug-swap/court-reserver.
const githubToken = Deno.env.get('COURT_GITHUB_TOKEN');
const workflowUrl = 'https://api.github.com/repos/bug-swap/court-reserver/actions/workflows/reserve.yml/dispatches';

const corsHeaders = {
  'Access-Control-Allow-Origin': siteOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Vary': 'Origin'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function authorizedOrigin(request: Request) {
  return request.headers.get('origin') === siteOrigin;
}

async function readSettings() {
  if (!projectUrl || !serviceKey) throw new Error('Settings service is not configured.');
  const authHeaders = serviceKey.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  const response = await fetch(`${projectUrl}/rest/v1/court_settings?select=sport,start_time,badminton_room,squash_fallback&id=eq.1`, {
    headers: { apikey: serviceKey, ...authHeaders },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not read settings (HTTP ${response.status}).`);
  const rows = await response.json();
  const row = rows[0];
  if (!row) return { sport: 'squash', startTime: '18:00', badmintonRoom: 'any', squashFallback: 'none' };
  return { sport: row.sport, startTime: row.start_time, badmintonRoom: row.badminton_room, squashFallback: row.squash_fallback };
}

async function rows(path: string) {
  if (!projectUrl || !serviceKey) throw new Error('Settings service is not configured.');
  const authHeaders = serviceKey.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, ...authHeaders },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not read ${path.split('?')[0]} (HTTP ${response.status}).`);
  return response.json();
}

function courtName(location: string) {
  const room = location.split(' - ').pop()?.trim() || location;
  const badminton = room.match(/^Badminton_Pickleball (\w+)$/);
  return badminton ? `Badminton court ${badminton[1]}` : room;
}

async function readReservations() {
  try {
    // Mirrored from EMS My Events by each automation run.
    const synced = await rows('court_reservations?select=starts_at,location,status&order=starts_at.desc&limit=60');
    return synced.map((row: Record<string, string>) => ({
      date: row.starts_at.slice(0, 10),
      startTime: row.starts_at.slice(11, 16),
      court: courtName(row.location),
      status: row.status
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not read synced reservations.');
  }
  // Before the first sync, fall back to what the automation booked. The raw EMS confirmation is never returned.
  const booked = await rows('court_bookings?select=target_date,sport,start_time,badminton_room&order=target_date.desc&limit=60');
  return booked.map((row: Record<string, string>) => ({
    date: row.target_date,
    startTime: row.start_time,
    court: row.sport === 'squash' ? 'Squash Court' : row.badminton_room === 'any' ? 'Badminton' : `Badminton court ${row.badminton_room}`,
    status: 'Confirmed'
  }));
}

async function writeSettings(settings: { sport: string; startTime: string; badmintonRoom: string; squashFallback: string }) {
  if (!projectUrl || !serviceKey) throw new Error('Settings service is not configured.');
  const authHeaders = serviceKey.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  const response = await fetch(`${projectUrl}/rest/v1/court_settings?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      ...authHeaders,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: 1,
      sport: settings.sport,
      start_time: settings.startTime,
      badminton_room: settings.badmintonRoom,
      squash_fallback: settings.squashFallback,
      updated_at: new Date().toISOString()
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not save settings (HTTP ${response.status}).`);
}

// EMS takes bookings for today and tomorrow only.
function bookableDates() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return [today, new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10)];
}

async function dispatch(inputs: Record<string, string>) {
  if (!githubToken) throw new Error('Slot booking is not configured yet (COURT_GITHUB_TOKEN is missing).');
  const response = await fetch(workflowUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'court-settings',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not start the EMS run (GitHub HTTP ${response.status}).`);
}

async function handleAction(body: Record<string, string>) {
  const { action, date } = body;
  if (!bookableDates().includes(date)) return json({ error: 'Choose today or tomorrow.' }, 400);
  if (action === 'slots') {
    await dispatch({ mode: 'slots', date });
    return json({ ok: true });
  }
  if (action !== 'book') return json({ error: 'Unknown action.' }, 400);
  const { sport, startTime, badmintonRoom } = body;
  if (!['squash', 'badminton'].includes(sport)) return json({ error: 'Choose squash or badminton.' }, 400);
  if (typeof startTime !== 'string' || !/^(?:[01]\d|2[0-2]):[0-5]\d$/.test(startTime)) return json({ error: 'Choose a valid slot.' }, 400);
  if (sport === 'badminton' && !['3A', '3B', '3C'].includes(badmintonRoom)) return json({ error: 'Choose a badminton court.' }, 400);
  await dispatch({ mode: 'book', date, sport, start_time: startTime, badminton_room: sport === 'badminton' ? badmintonRoom : 'any' });
  return json({ ok: true });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);

  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const slotsDate = params.get('slots');
      if (slotsDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(slotsDate)) return json({ error: 'Invalid date.' }, 400);
        const [row] = await rows(`court_availability?select=courts,fetched_at&target_date=eq.${slotsDate}`);
        return json(row ? { courts: row.courts, fetchedAt: row.fetched_at } : { courts: null, fetchedAt: null });
      }
      if (params.has('runs')) {
        const recent = await rows('court_runs?select=mode,target_date,outcome,error,started_at&order=started_at.desc&limit=5');
        return json(recent.map((run: Record<string, string>) => ({
          mode: run.mode, date: run.target_date, outcome: run.outcome, error: run.error, finishedAt: run.started_at
        })));
      }
      return json({ ...await readSettings(), reservations: await readReservations() });
    }
    if (request.method === 'POST') return await handleAction(await request.json() || {});
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed.' }, 405);

    const body = await request.json();
    const { sport, startTime, badmintonRoom, squashFallback = 'none' } = body || {};
    if (!['squash', 'badminton'].includes(sport)) return json({ error: 'Choose squash or badminton.' }, 400);
    if (typeof startTime !== 'string' || !/^(?:[01]\d|2[0-2]):[0-5]\d$/.test(startTime)) {
      return json({ error: 'Choose a start time that leaves one full hour before midnight.' }, 400);
    }
    if (!['any', '3A', '3B', '3C'].includes(badmintonRoom)) return json({ error: 'Choose a valid badminton court.' }, 400);
    if (!['none', 'badminton'].includes(squashFallback)) return json({ error: 'Choose what to do when squash is taken.' }, 400);

    await writeSettings({ sport, startTime, badmintonRoom, squashFallback });
    return json({ ok: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Settings request failed.');
    return json({ error: error instanceof Error ? error.message : 'Settings request failed.' }, 500);
  }
});
