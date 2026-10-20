const projectUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
const serviceKey = Deno.env.get('COURT_SUPABASE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const siteOrigin = 'https://bug-swap.github.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': siteOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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
  const response = await fetch(`${projectUrl}/rest/v1/court_settings?select=sport,start_time,badminton_room&id=eq.1`, {
    headers: { apikey: serviceKey, ...authHeaders },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not read settings (HTTP ${response.status}).`);
  const rows = await response.json();
  const row = rows[0];
  if (!row) return { sport: 'squash', startTime: '18:00', badmintonRoom: 'any' };
  return { sport: row.sport, startTime: row.start_time, badmintonRoom: row.badminton_room };
}

async function readReservations() {
  if (!projectUrl || !serviceKey) throw new Error('Settings service is not configured.');
  const authHeaders = serviceKey.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  // The confirmation column holds a raw EMS page with personal details, so it is never returned.
  const response = await fetch(`${projectUrl}/rest/v1/court_bookings?select=target_date,sport,start_time,badminton_room,booked_at&order=target_date.desc&limit=60`, {
    headers: { apikey: serviceKey, ...authHeaders },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not read reservations (HTTP ${response.status}).`);
  const rows = await response.json();
  return rows.map((row: Record<string, string>) => ({
    date: row.target_date,
    sport: row.sport,
    startTime: row.start_time,
    badmintonRoom: row.badminton_room,
    bookedAt: row.booked_at
  }));
}

async function writeSettings(settings: { sport: string; startTime: string; badmintonRoom: string }) {
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
      updated_at: new Date().toISOString()
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Could not save settings (HTTP ${response.status}).`);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);

  try {
    if (request.method === 'GET') return json({ ...await readSettings(), reservations: await readReservations() });
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed.' }, 405);

    const body = await request.json();
    const { sport, startTime, badmintonRoom } = body || {};
    if (!['squash', 'badminton'].includes(sport)) return json({ error: 'Choose squash or badminton.' }, 400);
    if (typeof startTime !== 'string' || !/^(?:[01]\d|2[0-2]):[0-5]\d$/.test(startTime)) {
      return json({ error: 'Choose a start time that leaves one full hour before midnight.' }, 400);
    }
    if (!['any', '3A', '3B', '3C'].includes(badmintonRoom)) return json({ error: 'Choose a valid badminton court.' }, 400);

    await writeSettings({ sport, startTime, badmintonRoom });
    return json({ ok: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Settings request failed.');
    return json({ error: error instanceof Error ? error.message : 'Settings request failed.' }, 500);
  }
});
