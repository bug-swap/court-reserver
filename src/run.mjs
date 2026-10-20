import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { bookCourt, keepAlive } from './booking.mjs';
import { decryptState, encryptState } from './crypto.mjs';
import { endTime, requestedRoom, requestedSport, requestedTime, targetDate } from './config.mjs';
import { hasBooking, loadSession, logRun, saveBooking, saveSession, saveSettings } from './supabase.mjs';
import { captureBrowserState, restoreSessionStorage } from './browser-state.mjs';

const date = targetDate();
const requestedMode = process.env.MODE || 'auto';
const mode = requestedMode === 'auto' ? (await hasBooking(date) ? 'keepalive' : 'book') : requestedMode;
if (!['book', 'keepalive', 'dry-run'].includes(mode)) throw new Error('MODE must be auto, book, keepalive, or dry-run');
const encrypted = await loadSession() || process.env.EMS_INITIAL_STATE ||
  await readFile('initial-state.txt', 'utf8').catch(() => { throw new Error('No EMS session in Supabase. Run npm run login to capture one.'); });
const state = decryptState(encrypted);
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
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    mail = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  }
}

const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
const context = await browser.newContext({ storageState: state.browserState });
await restoreSessionStorage(context, state.sessionStorage);
const page = await context.newPage();
let result;
let error;
let outcome;
try {
  if (mode === 'keepalive') {
    await keepAlive(page);
    outcome = 'session_active';
    console.log('EMS session active');
  } else if (mode !== 'keepalive' && (await hasBooking(date) || state.bookedDates?.includes(date))) {
    outcome = 'already_booked';
    console.log(`Already booked ${date}; skipping court selection`);
  } else {
    result = await bookCourt(page, { date, startTime, sport, badmintonRoom, contact, dryRun: mode === 'dry-run' });
    if (result.submitted) {
      await saveBooking({
        date,
        sport: result.sport,
        startTime,
        badmintonRoom: result.badmintonRoom,
        confirmation: result.confirmation
      });
      outcome = 'confirmed';
      const bookedCourt = result.sport === 'badminton' ? `badminton court ${result.badmintonRoom}` : 'squash';
      console.log(`Confirmed ${bookedCourt} for ${date} at ${startTime} Mountain time`);
    } else {
      outcome = 'dry_run';
      const selectedCourt = result.sport === 'badminton' ? `badminton court ${result.badmintonRoom}` : 'squash';
      console.log(`Dry run reached the final confirmation step with ${selectedCourt}.`);
    }
  }
} catch (caught) {
  error = caught;
  outcome = 'failed';
  await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
  console.error(caught.message);
} finally {
  try {
    if (!error) {
      Object.assign(state, await captureBrowserState(context, page, state.sessionStorage));
      const refreshed = encryptState(state);
      await saveSession(refreshed);
      await writeFile('session.enc', refreshed + '\n', { mode: 0o600 });
    }
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
    ? `CU court reservation could not be completed for ${date} at ${startTime} Mountain time. Check the GitHub Actions run for details. Error: ${error.message}`
    : result?.submitted
      ? `CU ${result.sport === 'badminton' ? `badminton court ${result.badmintonRoom}` : 'squash'} reservation confirmed for ${date}, ${startTime}–${endTime(startTime)} Mountain time.\n\n${result.confirmation}`
      : `CU court reservation for ${date} was already recorded. No duplicate was submitted.`;
  if (!mail) {
    console.error('Booking email unavailable: GMAIL_USER and GMAIL_APP_PASSWORD are required');
    process.exitCode = 1;
  } else {
    try {
      await mail.sendMail({
        from: process.env.GMAIL_USER,
        to: contact.email,
        subject: error ? `CU court reservation failed: ${date}` : `CU court reservation: ${date}`,
        text: body
      });
    } catch (mailError) {
      console.error(`Booking email failed: ${mailError.message}`);
      process.exitCode = 1;
    }
  }
}
if (error) process.exitCode = 1;
