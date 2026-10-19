import test from 'node:test';
import assert from 'node:assert/strict';

test('server writes encrypted session and successful booking using only its secret key', async () => {
  process.env.SUPABASE_URL = 'https://court-test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test';
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 201, text: async () => '' };
    return { ok: true, status: 200, text: async () => '[]' };
  };
  try {
    const { hasBooking, saveBooking, saveSession } = await import('../src/supabase.mjs');
    assert.equal(await hasBooking('2026-10-20'), false);
    await saveSession('CR1encrypted');
    await saveBooking({ date: '2026-10-20', sport: 'squash', startTime: '18:00', badmintonRoom: 'any', confirmation: 'confirmed' });
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /court_bookings\?select=target_date&target_date=eq\.2026-10-20$/);
    assert.equal(calls[1].options.headers.apikey, 'sb_secret_test');
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.equal(JSON.parse(calls[1].options.body).encrypted_state, 'CR1encrypted');
    assert.equal(JSON.parse(calls[2].options.body).target_date, '2026-10-20');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  }
});
