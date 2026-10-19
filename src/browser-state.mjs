const EMS_ORIGIN = 'https://ems.colorado.edu';

export async function captureBrowserState(context, page) {
  const browserState = await context.storageState({ indexedDB: true });
  const sessionStorage = new URL(page.url()).origin === EMS_ORIGIN
    ? JSON.parse(await page.evaluate(() => JSON.stringify(window.sessionStorage)))
    : {};
  return { browserState, sessionStorage };
}

export async function restoreSessionStorage(context, savedStorage = {}) {
  await context.addInitScript(storage => {
    if (window.location.origin !== 'https://ems.colorado.edu') return;
    for (const [name, value] of Object.entries(storage)) window.sessionStorage.setItem(name, value);
  }, savedStorage);
}
