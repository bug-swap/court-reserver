const EMS_ORIGIN = 'https://ems.colorado.edu';
const SSO_DOMAIN = /(^|\.)(fedauth\.colorado\.edu|microsoftonline\.com|microsoftazuread-sso\.com|login\.live\.com)$/;

export function withSsoCookies(browserState, sourceCookies = []) {
  const sso = sourceCookies.filter(cookie => SSO_DOMAIN.test(cookie.domain.replace(/^\./, '')));
  const id = cookie => `${cookie.domain}|${cookie.path}|${cookie.name}`;
  const replaced = new Set(sso.map(id));
  return { ...browserState, cookies: [...browserState.cookies.filter(cookie => !replaced.has(id(cookie))), ...sso] };
}

export async function captureBrowserState(context, page, previousSessionStorage = {}) {
  const browserState = await context.storageState({ indexedDB: true });
  const sessionStorage = new URL(page.url()).origin === EMS_ORIGIN
    ? JSON.parse(await page.evaluate(() => JSON.stringify(window.sessionStorage)))
    : previousSessionStorage;
  return { browserState, sessionStorage };
}

export async function restoreSessionStorage(context, savedStorage = {}) {
  await context.addInitScript(storage => {
    if (window.location.origin !== 'https://ems.colorado.edu') return;
    for (const [name, value] of Object.entries(storage)) window.sessionStorage.setItem(name, value);
  }, savedStorage);
}
