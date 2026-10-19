import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { bookCourt, keepAlive } from './booking.mjs';
import { decryptState, encryptState } from './crypto.mjs';
import { endTime, modeForSchedule, requestedRoom, requestedSport, requestedTime, targetDate } from './config.mjs';

const mode = process.env.MODE === 'auto' || !process.env.MODE ? modeForSchedule() : process.env.MODE;
if (!['book', 'keepalive', 'dry-run'].includes(mode)) throw new Error('MODE must be auto, book, keepalive, or dry-run');
const encrypted = await readFile('session.enc', 'utf8').catch(async () => await readFile('initial-state.txt', 'utf8'));
const state = decryptState(encrypted);
const date = targetDate();
const settings = JSON.parse(await readFile('site/config.json', 'utf8'));
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
try {
  if (mode === 'keepalive') {
    await keepAlive(page);
    console.log('EMS session active');
  } else if (mode === 'book' && state.bookedDates?.includes(date)) {
    console.log(`Already booked ${date}; skipping`);
  } else {
    result = await bookCourt(page, { date, startTime, sport, badmintonRoom, contact, dryRun: mode === 'dry-run' });
    if (result.submitted) {
      state.bookedDates = [...new Set([...(state.bookedDates || []), date])].slice(-90);
      console.log(`Confirmed ${sport} for ${date} at ${startTime} Mountain time`);
    } else console.log('Dry run reached the final confirmation step.');
  }
} catch (caught) {
  error = caught;
  await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
  console.error(caught.message);
} finally {
  state.browserState = await context.storageState();
  await writeFile('session.enc', encryptState(state) + '\n', { mode: 0o600 });
  await browser.close();
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
