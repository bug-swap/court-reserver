import { COURT_URL, EMS_URL } from './config.mjs';

async function firstVisible(candidates, description) {
  for (const locator of candidates) {
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) return first;
    if (await first.waitFor({ state: 'visible', timeoutMs: 2000 }).then(() => true).catch(() => false)) return first;
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
    .waitFor({ state: 'visible', timeoutMs: 30000 });
  const [year, month, day] = date.split('-');
  const dateUS = `${month}/${day}/${year}`;
  const start = startTime === '06:00' ? '6:00 AM' : '6:00 PM';
  const end = startTime === '06:00' ? '7:00 AM' : '7:00 PM';
  await fillField(page, /date/i, dateUS, ['input[name*="date" i]', 'input[id*="date" i]']);
  await fillField(page, /start time/i, start, ['input[name*="start" i]', 'input[id*="start" i]']);
  await fillField(page, /end time/i, end, ['input[name*="end" i]', 'input[id*="end" i]']);
  await (await firstVisible([
    page.getByRole('button', { name: /^search$/i }),
    page.locator('button:has-text("Search")')
  ], 'Search button')).click();
}

async function selectCourt(page, sport) {
  await page.getByText(new RegExp(sport, 'i')).first().waitFor({ state: 'visible', timeoutMs: 30000 });
  const row = await firstVisible([
    page.getByRole('row').filter({ hasText: new RegExp(sport, 'i') }),
    page.locator('tr').filter({ hasText: new RegExp(sport, 'i') })
  ], `${sport} court row`);
  const add = await firstVisible([
    row.getByRole('button', { name: /add|select|\+/i }),
    row.getByRole('link', { name: /add|select|\+/i }),
    row.locator('.btn-success, .add-room, [title*="add" i], [aria-label*="add" i]')
  ], `add button for ${sport} court`);
  await add.click();
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
  if (await page.getByRole('button', { name: /^sign in$/i }).isVisible().catch(() => false)) {
    throw new Error('EMS session expired. Run npm run login again and update EMS_INITIAL_STATE.');
  }
  if (!await page.getByText(/CREATE A RESERVATION/i).first().isVisible().catch(() => false)) {
    throw new Error('EMS signed-in home page could not be verified.');
  }
}

export async function keepAlive(page) {
  await checkSignedIn(page);
  await page.goto(COURT_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('login.microsoftonline.com')) throw new Error('EMS session expired');
}

export async function bookCourt(page, { date, startTime, sport, contact, dryRun = false }) {
  await keepAlive(page);
  await chooseDateAndTime(page, date, startTime);
  await selectCourt(page, sport);
  await fillDetails(page, contact);
  const create = await firstVisible([
    page.getByRole('button', { name: /create reservation/i }),
    page.getByRole('link', { name: /create reservation/i })
  ], 'Create Reservation button');
  if (dryRun) return { submitted: false, pageText: (await page.locator('body').innerText()).slice(-3000) };
  await create.click();
  await page.getByText(/reservation (created|confirmed|submitted)|confirmation number/i).first()
    .waitFor({ state: 'visible', timeoutMs: 30000 });
  const confirmation = (await page.locator('body').innerText()).slice(-1500);
  return { submitted: true, confirmation };
}
