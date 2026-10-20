import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { bookCourt, findSquashOpenings, keepAlive, readReservations } from './booking.mjs';
import { decryptState, encryptState } from './crypto.mjs';
import { emsTime, endTime, requestedFallback, requestedRoom, requestedSport, requestedTime, targetDate } from './config.mjs';
import { hasBooking, loadCanvasSession, loadSession, loadSettings, logRun, saveBooking, saveReservations, saveSession, saveSettings } from './supabase.mjs';
import { captureBrowserState, restoreSessionStorage, withSsoCookies } from './browser-state.mjs';

const date = targetDate();
const requestedMode = process.env.MODE || 'auto';
const mode = requestedMode === 'auto' ? (await hasBooking(date) ? 'keepalive' : 'book') : requestedMode;
if (!['book', 'keepalive', 'dry-run'].includes(mode)) throw new Error('MODE must be auto, book, keepalive, or dry-run');
const encrypted = await loadSession() || process.env.EMS_INITIAL_STATE ||
  await readFile('initial-state.txt', 'utf8').catch(() => { throw new Error('No EMS session in Supabase. Run npm run login to capture one.'); });
const state = decryptState(encrypted);
const initialSettings = JSON.parse(await readFile('site/config.json', 'utf8'));
const storedSettings = await loadSettings();
const settings = storedSettings
  ? {
      sport: storedSettings.sport,
      startTime: storedSettings.start_time,
      badmintonRoom: storedSettings.badminton_room,
      squashFallback: storedSettings.squash_fallback
    }
  : initialSettings;
if (!storedSettings) await saveSettings(settings);
const sport = requestedSport(process.env.SPORT || settings.sport);
const startTime = requestedTime(process.env.START_TIME || settings.startTime);
const badmintonRoom = requestedRoom(process.env.BADMINTON_ROOM || settings.badmintonRoom);
const squashFallback = requestedFallback(process.env.SQUASH_FALLBACK || settings.squashFallback);
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
const canvasSession = await loadCanvasSession().catch(caught => {
  console.error(`Shared CU SSO cookies unavailable: ${caught.message}`);
  return { cookies: [] };
});
const context = await browser.newContext({ storageState: withSsoCookies(state.browserState, canvasSession.cookies) });
await restoreSessionStorage(context, state.sessionStorage);
const page = await context.newPage();
let result;
let openings;
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
    result = await bookCourt(page, { date, startTime, sport, badmintonRoom, squashFallback, contact, dryRun: mode === 'dry-run' });
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
  if (mode === 'book' && ['confirmed', 'already_booked'].includes(outcome)) {
    openings = await findSquashOpenings(page, date, startTime).catch(caught => {
      console.error(`Could not read squash openings: ${caught.message}`);
    });
  }
  await readReservations(page).then(saveReservations).catch(caught => {
    console.error(`Could not sync EMS reservations: ${caught.message}`);
  });
} catch (caught) {
  error = caught;
  outcome = 'failed';
  await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
  console.error(caught.message);
  if (mode === 'book' && caught.message.startsWith('Squash is unavailable')) {
    // No automatic switch to another sport: report free squash times so a new one can be chosen on the settings page.
    openings = await findSquashOpenings(page, date, startTime).catch(() => undefined);
  }
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
  const squashLine = !openings ? ''
    : openings.length
      ? `\n\nOpen squash court times on ${date}: ${openings.map(o => `${emsTime(o.start)}–${emsTime(o.end)}`).join(', ')} Mountain time.`
      : `\n\nThe squash court has no open hour left on ${date}.`;
  const settingsLine = error && openings ? '\n\nTo book another time, change the start time at https://bug-swap.github.io/court-reserver/ and run the workflow again.' : '';
  const body = error
    ? `CU court reservation could not be completed for ${date} at ${startTime} Mountain time. Check the GitHub Actions run for details. Error: ${error.message}`
    : result?.submitted
      ? `CU ${result.sport === 'badminton' ? `badminton court ${result.badmintonRoom}` : 'squash'} reservation confirmed for ${date}, ${startTime}–${endTime(startTime)} Mountain time.\n\n${result.confirmation}`
      : `CU court reservation for ${date} was already recorded. No duplicate was submitted.`;
  const text = body + squashLine + settingsLine;
  if (!mail) {
    console.error('Booking email unavailable: GMAIL_USER and GMAIL_APP_PASSWORD are required');
    process.exitCode = 1;
  } else {
    try {
      await mail.sendMail({
        from: process.env.GMAIL_USER,
        to: contact.email,
        subject: error ? `CU court reservation failed: ${date}` : `CU court reservation: ${date}`,
        text
      });
    } catch (mailError) {
      console.error(`Booking email failed: ${mailError.message}`);
      process.exitCode = 1;
    }
  }
}
if (error) process.exitCode = 1;
