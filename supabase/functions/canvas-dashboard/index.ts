const projectUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
const serviceKey = Deno.env.get('COURT_SUPABASE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('COURT_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
const ownerEmail = Deno.env.get('COURT_SETTINGS_OWNER_EMAIL')?.trim().toLowerCase();
const siteOrigin = 'https://bug-swap.github.io';
const allowedWindows = new Set([24, 72, 168, 336, 720]);

const corsHeaders = {
  'Access-Control-Allow-Origin': siteOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

async function requireOwner(request: Request) {
  if (!projectUrl || !anonKey || !ownerEmail) throw new Error('Dashboard service is not configured.');
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const response = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return false;
  const user = await response.json();
  return typeof user.email === 'string' && user.email.toLowerCase() === ownerEmail;
}

async function readAssignments(hours: number) {
  if (!projectUrl || !serviceKey) throw new Error('Dashboard service is not configured.');
  const serviceAuth = serviceKey.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {};
  const now = Date.now();
  const cutoff = new Date(now + hours * 60 * 60 * 1000).toISOString();
  const overdueLimit = new Date(now - hours * 60 * 60 * 1000).toISOString();
  const headers = { apikey: serviceKey, ...serviceAuth };
  const assignmentsUrl = new URL(`${projectUrl}/rest/v1/unsubmitted_assignments`);
  assignmentsUrl.search = new URLSearchParams({
    select: 'assignment_canvas_id,course_name,course_short_name,assignment_name,assignment_type,points_possible,due_at,canvas_url',
    and: `(due_at.gte.${overdueLimit},due_at.lte.${cutoff})`,
    order: 'due_at.asc',
    limit: '500'
  }).toString();
  const [assignmentsResponse, checkedResponse] = await Promise.all([
    fetch(assignmentsUrl, { headers, signal: AbortSignal.timeout(15000) }),
    fetch(`${projectUrl}/rest/v1/courses?select=updated_at&order=updated_at.desc&limit=1`, {
      headers, signal: AbortSignal.timeout(15000)
    })
  ]);
  if (!assignmentsResponse.ok) throw new Error(`Could not read assignment data (HTTP ${assignmentsResponse.status}).`);
  if (!checkedResponse.ok) throw new Error(`Could not read the latest check time (HTTP ${checkedResponse.status}).`);
  const [assignments, courses] = await Promise.all([assignmentsResponse.json(), checkedResponse.json()]);
  return { assignments, lastCheckedAt: courses[0]?.updated_at || null };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!authorizedOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    if (!await requireOwner(request)) return json({ error: 'Sign in with the Canvas owner email to view assignments.' }, 403);
    const hours = Number(new URL(request.url).searchParams.get('hours') || '168');
    if (!allowedWindows.has(hours)) return json({ error: 'Choose a supported deadline window.' }, 400);
    return json(await readAssignments(hours));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dashboard request failed.');
    return json({ error: error instanceof Error ? error.message : 'Dashboard request failed.' }, 500);
  }
});
