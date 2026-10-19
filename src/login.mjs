import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { EMS_URL } from './config.mjs';
import { encryptState } from './crypto.mjs';

process.env.STATE_KEY ||= randomBytes(32).toString('hex');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(EMS_URL);
console.log('Sign in to CU EMS in this window. Once “CREATE A RESERVATION” appears, press Enter here.');
await new Promise(resolve => process.stdin.once('data', resolve));
await page.goto(EMS_URL);
if (!await page.getByText(/CREATE A RESERVATION/i).isVisible().catch(() => false)) {
  throw new Error('EMS does not appear signed in. No session was saved.');
}
const encrypted = encryptState({ browserState: await context.storageState(), bookedDates: [] });
await writeFile('initial-state.txt', encrypted + '\n', { mode: 0o600 });
await writeFile('state-key.txt', process.env.STATE_KEY + '\n', { mode: 0o600 });
console.log('Saved encrypted initial-state.txt and its key in state-key.txt. Add both as GitHub Actions secrets.');
await browser.close();
