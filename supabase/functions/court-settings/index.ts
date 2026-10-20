import { courtAvailability } from '../../../src/availability.mjs';

const projectUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
const serviceKey = Deno.env.get('COURT_SUPABASE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const siteOrigin = 'https://bug-swap.github.io';
// Fine-grained token limited to Actions: write on bug-swap/court-reserver.
const githubToken = Deno.env.get('COURT_GITHUB_TOKEN');
const workflowUrl = 'https://api.github.com/repos/bug-swap/court-reserver/actions/workflows/reserve.yml/dispatches';
// Same key as the runner's STATE_KEY, so this function can read the saved EMS session.
const stateKey = Deno.env.get('COURT_STATE_KEY');
const emsOrigin = 'https://ems.colorado.edu';
const courtUrl = `${emsOrigin}/RoomRequest.aspx?data=ity3Dem%2ByxxGFZTQvNr975iYyqy0fdZA`;
const courtTemplateId = 355;
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

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

// Mirrors src/crypto.mjs: base64("CR1" | 12-byte IV | 16-byte tag | AES-256-GCM ciphertext).
async function decryptState(encoded: string) {
  if (!stateKey || !/^[0-9a-f]{64}$/i.test(stateKey)) throw new Error('Live EMS times are not configured yet (COURT_STATE_KEY is missing).');
  const payload = Uint8Array.from(atob(encoded.trim()), c => c.charCodeAt(0));
  if (new TextDecoder().decode(payload.subarray(0, 3)) !== 'CR1') throw new Error('Saved EMS session is unreadable.');
  const keyBytes = Uint8Array.from(stateKey.match(/../g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const sealed = new Uint8Array([...payload.subarray(31), ...payload.subarray(15, 31)]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(3, 15) }, key, sealed);
  return JSON.parse(new TextDecoder().decode(plain));
}

function denverClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Reads free court times straight from EMS's JSON API with the session the runner keeps signed in.
async function liveAvailability(date: string) {
  const [session] = await rows('court_session?select=encrypted_state&id=eq.1');
  if (!session) throw new Error('No saved EMS session yet.');
  const state = await decryptState(session.encrypted_state);
  const cookies = new Map<string, string>(state.browserState.cookies
    .filter((cookie: { domain: string }) => cookie.domain.replace(/^\./, '') === 'ems.colorado.edu')
    .map((cookie: { name: string; value: string }) => [cookie.name, cookie.value]));
  const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  const page = await fetch(courtUrl, { headers: { cookie: cookieHeader(), 'user-agent': browserAgent }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  for (const line of page.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split).trim(), pair.slice(split + 1));
  }
  const csrf = (await page.text()).match(/id="deaCSRFToken" value="([^"]+)"/)?.[1];
  if (page.status !== 200 || !csrf) throw new Error('The saved EMS session has expired.');

  const api = async (method: string, body: unknown) => {
    const response = await fetch(`${emsOrigin}/ServerApi.aspx/${method}`, {
      method: 'POST',
      headers: {
        cookie: cookieHeader(), 'user-agent': browserAgent, 'content-type': 'application/json; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest', 'dea-csrftoken': csrf, origin: emsOrigin, referer: courtUrl
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`EMS ${method} failed (HTTP ${response.status}).`);
    return JSON.parse((await response.json()).d);
  };
  const filters = [
    { filterName: 'Locations', value: '-1', displayValue: '(all)', filterType: 8 },
    { filterName: 'StartDate', value: `${date} 00:00:00`, displayValue: null, filterType: 3 },
    { filterName: 'EndDate', value: `${date} 23:59:59`, filterType: 3, displayValue: null },
    { filterName: 'TimeZone', value: 68, displayValue: 'Mountain Time', filterType: 2 }
  ];
  const rooms = await api('GetBrowseLocationsRoomsForRoomRequest', {
    templateId: courtTemplateId,
    searchData: {
      TemplateId: courtTemplateId, Start: `${date} 09:00:00`, End: `${date} 10:00:00`, Dates: [`${date} 00:00:00`], DatesGmt: null,
      TimeZoneId: 68, FilterType: 0, IsPam: false, BookingId: -1, IsVCEdit: false, RoomName: null, FavoritesOnly: false, PageMode: null, Cart: []
    },
    filterData: { filters }
  });
  if (!rooms.CanBook) throw new Error('The saved EMS session has expired.');
  const roomIds = rooms.Buildings.flatMap((building: { Rooms: { Id: number }[] }) => building.Rooms.map(room => room.Id)).join(',');
  const bookings = await api('GetBrowseLocationsBookingsForRoomRequest', {
    templateId: courtTemplateId,
    filterData: { filters: [...filters, { filterName: 'Rooms', value: roomIds, displayValue: null, filterType: 7 }] }
  });
  const now = denverClock();
  const courts = courtAvailability(rooms, bookings, date, date === now.date ? now.time : '00:00');
  const fetchedAt = new Date().toISOString();
  await saveAvailability(date, courts, fetchedAt);
  return { courts, fetchedAt, live: true };
}

async function saveAvailability(date: string, courts: unknown, fetchedAt: string) {
  const authHeaders = serviceKey!.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  await fetch(`${projectUrl}/rest/v1/court_availability?on_conflict=target_date`, {
    method: 'POST',
    headers: { apikey: serviceKey!, ...authHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ target_date: date, courts, fetched_at: fetchedAt }),
    signal: AbortSignal.timeout(10000)
  });
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
        if (params.has('live')) {
          if (!bookableDates().includes(slotsDate)) return json({ error: 'Choose today or tomorrow.' }, 400);
          try {
            return json(await liveAvailability(slotsDate));
          } catch (error) {
            const [row] = await rows(`court_availability?select=courts,fetched_at&target_date=eq.${slotsDate}`);
            return json({ courts: row?.courts ?? null, fetchedAt: row?.fetched_at ?? null, live: false, liveError: error instanceof Error ? error.message : 'EMS could not be reached.' });
          }
        }
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
