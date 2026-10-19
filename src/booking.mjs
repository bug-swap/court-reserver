import { COURT_URL, EMS_URL, emsTime, endTime } from './config.mjs';

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
  if (tag === 'select') await yes.selectOption({ label: 'Yes' });
  else await yes.check().catch(async () => yes.click());
}

async function chooseDateAndTime(page, date, startTime) {
  await page.getByRole('button', { name: /search/i }).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const [year, month, day] = date.split('-');
  const dateUS = `${month}/${day}/${year}`;
  const start = emsTime(startTime);
  const end = emsTime(endTime(startTime));
  await fillField(page, /Date Required/i, dateUS, ['input[name*="date" i]', 'input[id*="date" i]']);
  const startControl = await firstVisible([
    page.locator('[aria-label*="Edit booking start time" i], [title*="Edit booking start time" i]'),
    page.getByText('Start Time', { exact: true }).locator('xpath=..')
  ], 'start time picker');
  await startControl.click();
  await fillField(page, /StartTime Required/i, start, ['input[name*="StartTime" i]', 'input[id*="StartTime" i]']);
  const endControl = await firstVisible([
    page.locator('[aria-label*="Edit booking end time" i], [title*="Edit booking end time" i]'),
    page.getByText('End Time', { exact: true }).locator('xpath=..')
  ], 'end time picker');
  await endControl.click();
  await fillField(page, /EndTime Required/i, end, ['input[name*="EndTime" i]', 'input[id*="EndTime" i]']);
  if (await page.getByText(/Date must be prior|Start Time in the past/i).first().isVisible().catch(() => false)) {
    throw new Error('EMS rejected the selected date or time before searching');
  }
  await (await firstVisible([
    page.getByRole('button', { name: /^search$/i }),
    page.locator('button:has-text("Search")')
  ], 'Search button')).click();
}

async function selectCourt(page, sport, badmintonRoom) {
  await page.getByText('Rooms You Can Reserve').waitFor({ state: 'visible', timeout: 30000 });
  const roomNames = sport === 'squash'
    ? ['Squash Court']
    : badmintonRoom === 'any'
      ? ['Badminton_Pickleball 3A', 'Badminton_Pickleball 3B', 'Badminton_Pickleball 3C']
      : [`Badminton_Pickleball ${badmintonRoom}`];
  let add;
  for (const roomName of roomNames) {
    const candidates = [
      page.locator(`[aria-label*="Add Room to Cart"][aria-label*="${roomName}"], [title*="Add Room to Cart"][title*="${roomName}"]`),
      page.getByText(roomName, { exact: true }).locator('xpath=..').locator('[aria-label*="Add Room to Cart"], [title*="Add Room to Cart"]')
    ];
    for (const candidate of candidates) {
      if (await candidate.first().isVisible().catch(() => false)) { add = candidate.first(); break; }
    }
    if (add) break;
  }
  if (!add) throw new Error(`No selectable ${sport} court found for the requested hour`);
  await add.click();
  await page.getByText(/My Cart \(1\)/i).waitFor({ state: 'visible', timeout: 10000 });
  await (await firstVisible([
    page.getByRole('button', { name: /next step/i }),
    page.getByRole('link', { name: /next step/i })
  ], 'Next Step button')).click();
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
  const location = new URL(page.url());
  const safeLocation = `${location.hostname}${location.pathname}`;
  if (await page.getByRole('button', { name: /^sign in$/i }).isVisible().catch(() => false)) {
    throw new Error(`EMS session requires sign-in at ${safeLocation}. Run npm run login again.`);
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

export async function bookCourt(page, { date, startTime, sport, badmintonRoom, contact, dryRun = false }) {
  await keepAlive(page);
  await chooseDateAndTime(page, date, startTime);
  await selectCourt(page, sport, badmintonRoom);
  await fillDetails(page, contact);
  const create = await firstVisible([
    page.getByRole('button', { name: /create reservation/i }),
    page.getByRole('link', { name: /create reservation/i })
  ], 'Create Reservation button');
  if (dryRun) return { submitted: false, pageText: (await page.locator('body').innerText()).slice(-3000) };
  await create.click();
  await page.getByText(/reservation (created|confirmed|submitted)|confirmation number/i).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const confirmation = (await page.locator('body').innerText()).slice(-1500);
  return { submitted: true, confirmation };
}
