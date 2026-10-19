import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { bookCourt, keepAlive } from './booking.mjs';
import { decryptState, encryptState } from './crypto.mjs';
import { endTime, modeForSchedule, requestedRoom, requestedSport, requestedTime, targetDate } from './config.mjs';
import { hasBooking, loadSession, logRun, saveBooking, saveSession, saveSettings } from './supabase.mjs';

const mode = process.env.MODE === 'auto' || !process.env.MODE ? modeForSchedule() : process.env.MODE;
if (!['book', 'keepalive', 'dry-run'].includes(mode)) throw new Error('MODE must be auto, book, keepalive, or dry-run');
const encrypted = await loadSession() || process.env.EMS_INITIAL_STATE ||
  await readFile('initial-state.txt', 'utf8').catch(() => { throw new Error('No EMS session in Supabase. Run npm run login to capture one.'); });
const state = decryptState(encrypted);
const date = targetDate();
const settings = JSON.parse(await readFile('site/config.json', 'utf8'));
await saveSettings(settings);
const sport = requestedSport(process.env.SPORT || settings.sport);
const startTime = requestedTime(process.env.START_TIME || settings.startTime);
const badmintonRoom = requestedRoom(process.env.BADMINTON_ROOM || settings.badmintonRoom);
const contact = {
  name: process.env.CONTACT_NAME,
  phone: process.env.CONTACT_PHONE,
  email: process.env.CONTACT_EMAIL
};
let mail;
if (mode === 'book') {
  if (Object.values(contact).some(value => !value)) throw new Error('CONTACT_NAME, CONTACT_PHONE, CONTACT_EMAIL are required');
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required');
  mail = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await mail.verify();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: state.browserState });
const page = await context.newPage();
let result;
let error;
let outcome;
try {
  if (mode === 'keepalive') {
    await keepAlive(page);
    outcome = 'session_active';
    console.log('EMS session active');
  } else if (mode === 'book' && (await hasBooking(date) || state.bookedDates?.includes(date))) {
    outcome = 'already_booked';
    console.log(`Already booked ${date}; skipping`);
  } else {
    result = await bookCourt(page, { date, startTime, sport, badmintonRoom, contact, dryRun: mode === 'dry-run' });
    if (result.submitted) {
      await saveBooking({ date, sport, startTime, badmintonRoom, confirmation: result.confirmation });
      outcome = 'confirmed';
      console.log(`Confirmed ${sport} for ${date} at ${startTime} Mountain time`);
    } else {
      outcome = 'dry_run';
      console.log('Dry run reached the final confirmation step.');
    }
  }
} catch (caught) {
  error = caught;
  outcome = 'failed';
  await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
  console.error(caught.message);
} finally {
  try {
    state.browserState = await context.storageState();
    const refreshed = encryptState(state);
    await saveSession(refreshed);
    await writeFile('session.enc', refreshed + '\n', { mode: 0o600 });
  } catch (caught) {
    error ||= caught;
    outcome = 'failed';
  } finally {
    await browser.close();
  }
  await logRun({ mode, date, outcome, error: error?.message }).catch(caught => {
    error ||= caught;
    console.error(`Could not record run: ${caught.message}`);
  });
}

if (mode === 'book') {
  const body = error
    ? `CU court reservation failed for ${date} at ${startTime} Mountain time. Check the GitHub Actions run and renew the EMS session if needed. Error: ${error.message}`
    : result?.submitted
      ? `CU ${sport} court reservation confirmed for ${date}, ${startTime}–${endTime(startTime)} Mountain time.\n\n${result.confirmation}`
      : `CU court reservation for ${date} was already recorded. No duplicate was submitted.`;
  await mail.sendMail({
    from: process.env.GMAIL_USER,
    to: contact.email,
    subject: error ? `CU court reservation failed: ${date}` : `CU court reservation: ${date}`,
    text: body
  });
}
if (error) process.exitCode = 1;
