import { COURT_URL, EMS_URL, emsHeadingDate, emsTime, endTime } from './config.mjs';
import { clock, courtAvailability, minutes, squashOpenings } from './availability.mjs';

export function courtCandidates(sport, badmintonRoom, squashFallback = 'none') {
  if (sport === 'squash') {
    return [
      { sport: 'squash', room: null, name: 'Squash Court' },
      ...(squashFallback === 'badminton' ? ['3C', '3A', '3B'] : []).map(room => ({
        sport: 'badminton',
        room,
        name: `Badminton_Pickleball ${room}`
      }))
    ];
  }

  const rooms = badmintonRoom === 'any' ? ['3A', '3B', '3C'] : [badmintonRoom];
  return rooms.map(room => ({
    sport: 'badminton',
    room,
    name: `Badminton_Pickleball ${room}`
  }));
}

async function firstVisible(candidates, description) {
  for (const locator of candidates) {
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) return first;
    if (await first.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) return first;
  }
  throw new Error(`Could not find ${description}; the EMS form may have changed`);
}

async function fillField(page, label, value, selectors = []) {
  const input = await firstVisible([
    page.getByLabel(label),
    page.getByPlaceholder(label),
    ...selectors.map(selector => page.locator(selector))
  ], String(label));
  await input.fill(value);
  return input;
}

async function closeTimePicker(page) {
  const clickOff = page.locator('[data-action="close"].picker-clickoff:visible').last();
  if (await clickOff.count()) {
    await clickOff.click();
    await clickOff.waitFor({ state: 'hidden' });
  }
}

async function chooseYes(page, label) {
  const question = page.getByText(label).first();
  const parent = question.locator('xpath=..');
  const grandparent = question.locator('xpath=../..');
  const yes = await firstVisible([
    page.getByRole('combobox', { name: label }),
    page.getByLabel(label),
    page.getByRole('group', { name: label }).getByLabel(/^yes$/i),
    parent.getByRole('radio', { name: /^yes$/i }),
    grandparent.getByRole('radio', { name: /^yes$/i }),
    parent.getByRole('combobox'),
    grandparent.getByRole('combobox')
  ], `Yes choice for ${label}`);
  const tag = await yes.evaluate(element => element.tagName.toLowerCase());
  if (tag === 'select') {
    const options = await yes.locator('option').evaluateAll(elements =>
      elements.map(option => ({
        label: option.label.trim(),
        value: option.value
      }))
    );
    const affirmative = options.find(option => /^yes$/i.test(option.label));
    if (!affirmative) {
      throw new Error(`Could not find a Yes option for ${label}; available options: ${options.map(option => option.label).join(', ')}`);
    }
    await yes.selectOption({ value: affirmative.value });
  } else {
    await yes.check().catch(async () => yes.click());
  }
}

async function chooseDateAndTime(page, date, startTime) {
  await page.getByRole('button', { name: /search/i }).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const [year, month, day] = date.split('-');
  const dateUS = `${month}/${day}/${year}`;
  const start = emsTime(startTime);
  const end = emsTime(endTime(startTime));
  // The date picker only commits typed text on blur; clicking the time picker alone leaves today's date.
  await (await fillField(page, /Date Required/i, dateUS, ['input[name*="date" i]', 'input[id*="date" i]'])).press('Tab');
  const startControl = await firstVisible([
    page.locator('[aria-label*="Edit booking start time" i], [title*="Edit booking start time" i]'),
    page.getByText('Start Time', { exact: true }).locator('xpath=..')
  ], 'start time picker');
  await startControl.click();
  await fillField(page, /StartTime Required/i, start, ['input[name*="StartTime" i]', 'input[id*="StartTime" i]']);
  await closeTimePicker(page);
  const endControl = await firstVisible([
    page.locator('[aria-label*="Edit booking end time" i], [title*="Edit booking end time" i]'),
    page.getByText('End Time', { exact: true }).locator('xpath=..')
  ], 'end time picker');
  await endControl.click();
  await fillField(page, /EndTime Required/i, end, ['input[name*="EndTime" i]', 'input[id*="EndTime" i]']);
  await closeTimePicker(page);
  if (await page.getByText(/Date must be prior|Start Time in the past/i).first().isVisible().catch(() => false)) {
    throw new Error('EMS rejected the selected date or time before searching');
  }
  // EMS silently keeps today when the typed date is not accepted; never book the wrong day.
  const heading = (await page.getByText(/New Booking for/i).first().locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
  if (!heading.includes(emsHeadingDate(date))) {
    throw new Error(`EMS kept "${heading}" instead of ${emsHeadingDate(date)}`);
  }
  await (await firstVisible([
    page.getByRole('button', { name: /^search$/i }),
    page.locator('button:has-text("Search")')
  ], 'Search button')).click();
}

async function selectCourt(page, sport, badmintonRoom, squashFallback) {
  await page.getByText('Rooms You Can Reserve').first().waitFor({ state: 'visible', timeout: 30000 });
  let selected;
  for (const court of courtCandidates(sport, badmintonRoom, squashFallback)) {
    const candidates = [
      page.locator(`[aria-label*="Add Room to Cart"][aria-label*="${court.name}"], [title*="Add Room to Cart"][title*="${court.name}"]`),
      page.getByText(court.name, { exact: true }).locator('xpath=..').locator('[aria-label*="Add Room to Cart"], [title*="Add Room to Cart"]')
    ];
    for (const candidate of candidates) {
      if (await candidate.first().isVisible().catch(() => false)) {
        selected = court;
        await candidate.first().click();
        break;
      }
    }
    if (selected) break;
  }
  if (!selected) {
    const fallback = sport === 'squash'
      ? squashFallback === 'badminton'
        ? 'Squash is unavailable within 3 hours and badminton courts 3C, 3A, and 3B are also unavailable'
        : 'Squash is unavailable (no backup court is chosen)'
      : `No selectable badminton court found${badmintonRoom === 'any' ? ' (tried 3A, 3B, 3C)' : ` for court ${badmintonRoom}`}`;
    throw new Error(`${fallback} for the requested hour`);
  }
  await page.waitForFunction(() => {
    const cart = document.querySelector('#cart-header-container');
    return /My Cart\s*\(\s*1\s*\)/i.test(cart?.textContent || '');
  }, null, { timeout: 10000 });
  await (await firstVisible([
    page.getByRole('button', { name: /next step/i }),
    page.getByRole('link', { name: /next step/i })
  ], 'Next Step button')).click();
  return selected;
}

async function fillDetails(page, contact) {
  await fillField(page, /contact name/i, contact.name);
  await fillField(page, /contact phone/i, contact.phone);
  await fillField(page, /contact email address/i, contact.email);
  await chooseYes(page, /current recreation center membership/i);
  await chooseYes(page, /courts must be used for/i);
}

export async function checkSignedIn(page) {
  await page.goto(EMS_URL, { waitUntil: 'domcontentloaded' });
  const reservationLinks = page.locator('a[href*="BrowseReservations.aspx"], a[href*="RoomRequest.aspx"]');
  await reservationLinks.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  const signIn = page.getByRole('button', { name: /^sign in$/i });
  if (await signIn.isVisible().catch(() => false)) {
    // emsAuthToken only lasts hours; the shared CU SSO cookies can sign EMS back in without a prompt.
    await signIn.click();
    await reservationLinks.first().waitFor({ state: 'attached', timeout: 45000 }).catch(() => {});
  }
  const location = new URL(page.url());
  const safeLocation = `${location.hostname}${location.pathname}`;
  if (location.origin !== new URL(EMS_URL).origin || await signIn.isVisible().catch(() => false)) {
    throw new Error(`EMS session requires sign-in at ${safeLocation}. CU SSO expired; run canvas-emailer's login (or npm run login) again.`);
  }
  if (await reservationLinks.count() === 0) {
    throw new Error(`EMS signed-in home page could not be verified at ${safeLocation}.`);
  }
}

export async function keepAlive(page) {
  await checkSignedIn(page);
  await page.goto(COURT_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('login.microsoftonline.com')) throw new Error('EMS session expired');
}

function rethrowUnlessSquashTaken(error) {
  if (!error.message.startsWith('Squash is unavailable')) throw error;
  return null;
}

// Runs an EMS room search and returns the room and booking data behind its results grid.
async function search(page, date, startTime) {
  const json = async response => JSON.parse((await response.json()).d);
  const [rooms, bookings] = await Promise.all([
    page.waitForResponse(r => r.url().includes('GetBrowseLocationsRoomsForRoomRequest'), { timeout: 60000 }).then(json),
    page.waitForResponse(r => r.url().includes('GetBrowseLocationsBookingsForRoomRequest'), { timeout: 60000 }).then(json),
    chooseDateAndTime(page, date, startTime)
  ]);
  return { rooms, bookings };
}

export async function bookCourt(page, { date, startTime, sport, badmintonRoom, squashFallback, contact, dryRun = false }) {
  await keepAlive(page);
  const availability = await search(page, date, startTime);
  let bookedTime = startTime;
  let selectedCourt;
  if (sport === 'squash' && squashFallback === 'badminton') {
    // Prefer squash at another time within three hours; badminton only when none fits.
    selectedCourt = await selectCourt(page, 'squash', badmintonRoom, 'none').catch(rethrowUnlessSquashTaken);
    const nearby = selectedCourt ? null : nearestSquashStart(squashOpenings(availability.rooms, availability.bookings, date), startTime);
    if (nearby) {
      await search(page, date, nearby);
      selectedCourt = await selectCourt(page, 'squash', badmintonRoom, 'none');
      bookedTime = nearby;
    } else if (!selectedCourt) {
      selectedCourt = await selectCourt(page, sport, badmintonRoom, squashFallback);
    }
  } else {
    selectedCourt = await selectCourt(page, sport, badmintonRoom, squashFallback);
  }
  if (!dryRun) await fillDetails(page, contact);
  const create = await firstVisible([
    page.getByRole('button', { name: /create reservation/i }),
    page.getByRole('link', { name: /create reservation/i })
  ], 'Create Reservation button');
  if (dryRun) {
    return {
      submitted: false,
      sport: selectedCourt.sport,
      badmintonRoom: selectedCourt.room || badmintonRoom,
      startTime: bookedTime,
      pageText: (await page.locator('body').innerText()).slice(-3000)
    };
  }
  await create.click();
  await page.getByText(/reservation (created|confirmed|submitted)|confirmation number/i).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const confirmation = (await page.locator('body').innerText()).slice(-1500);
  return {
    submitted: true,
    sport: selectedCourt.sport,
    badmintonRoom: selectedCourt.room || badmintonRoom,
    startTime: bookedTime,
    confirmation
  };
}

export async function findAvailability(page, date, notBefore) {
  await keepAlive(page);
  const { rooms, bookings } = await search(page, date, '09:00');
  return courtAvailability(rooms, bookings, date, notBefore);
}

// The open squash start closest to the preferred time, at most maxShift minutes away.
export function nearestSquashStart(openings, startTime, maxShift = 180) {
  const preferred = minutes(startTime);
  let best = null;
  for (const opening of openings) {
    const start = Math.min(Math.max(preferred, minutes(opening.start)), minutes(opening.lastStart));
    const shift = Math.abs(start - preferred);
    if (shift <= maxShift && (best === null || shift < Math.abs(best - preferred))) best = start;
  }
  return best === null ? null : clock(best);
}

export async function findSquashOpenings(page, date, startTime) {
  await keepAlive(page);
  const { rooms, bookings } = await search(page, date, startTime);
  return squashOpenings(rooms, bookings, date);
}

// The reservations on EMS's My Events page: upcoming plus the most recent past ones.
export async function readReservations(page) {
  const list = () => page.waitForResponse(r => r.url().includes('PopulateReservationList'), { timeout: 30000 })
    .then(async response => JSON.parse((await response.json()).d));
  // The first render is server-side; switching tabs is what calls the JSON API.
  await page.goto(`${new URL(EMS_URL).origin}/BrowseReservations.aspx`, { waitUntil: 'networkidle' });
  const [past] = await Promise.all([list(), page.getByText(/^past$/i).first().click()]);
  const [current] = await Promise.all([list(), page.getByText(/^current$/i).first().click()]);
  return [...current.currentReservations.eventList || [], ...past.pastReservations.eventList || []].map(event => ({
    emsId: event.id,
    startsAt: event.start,
    location: event.location,
    status: event.status
  }));
}
