import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { EMS_URL } from './config.mjs';
import { encryptState } from './crypto.mjs';
import { saveSession } from './supabase.mjs';
import { captureBrowserState } from './browser-state.mjs';

process.env.STATE_KEY ||= randomBytes(32).toString('hex');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(EMS_URL);
console.log('Sign in to CU EMS in this window. Once “CREATE A RESERVATION” appears, press Enter here.');
await new Promise(resolve => process.stdin.once('data', resolve));
if (new URL(page.url()).origin !== new URL(EMS_URL).origin ||
    await page.getByRole('button', { name: /^sign in$/i }).isVisible().catch(() => false) ||
    await page.locator('a[href*="BrowseReservations.aspx"]').count() === 0) {
  throw new Error('EMS does not appear signed in. No session was saved.');
}
const encrypted = encryptState({ ...(await captureBrowserState(context, page)), bookedDates: [] });
await writeFile('initial-state.txt', encrypted + '\n', { mode: 0o600 });
await writeFile('state-key.txt', process.env.STATE_KEY + '\n', { mode: 0o600 });
console.log('Saved encrypted initial-state.txt and its key in state-key.txt. Add STATE_KEY as a GitHub Actions secret.');
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  await saveSession(encrypted);
  console.log('Uploaded encrypted EMS session to Supabase.');
}
await browser.close();
