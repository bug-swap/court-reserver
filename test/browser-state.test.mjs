import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBrowserState, restoreSessionStorage, withSsoCookies } from '../src/browser-state.mjs';

test('captures EMS session storage and IndexedDB with the encrypted browser state', async () => {
  const context = {
    storageState: async options => {
      assert.equal(options.indexedDB, true);
      return { cookies: [], origins: [] };
    }
  };
  const page = {
    url: () => 'https://ems.colorado.edu/Default.aspx',
    evaluate: async () => '{"auth":"opaque"}'
  };
  assert.deepEqual(await captureBrowserState(context, page), {
    browserState: { cookies: [], origins: [] },
    sessionStorage: { auth: 'opaque' }
  });
});

test('does not capture storage from another origin', async () => {
  const context = { storageState: async () => ({ cookies: [], origins: [] }) };
  const page = {
    url: () => 'https://login.microsoftonline.com/',
    evaluate: () => { throw new Error('should not read other origin'); }
  };
  assert.deepEqual((await captureBrowserState(context, page)).sessionStorage, {});
  assert.deepEqual(
    (await captureBrowserState(context, page, { auth: 'keep-me' })).sessionStorage,
    { auth: 'keep-me' }
  );
  let installed;
  await restoreSessionStorage({ addInitScript: async (script, storage) => { installed = { script, storage }; } }, { auth: 'opaque' });
  assert.deepEqual(installed.storage, { auth: 'opaque' });
});

test('takes fresher CU SSO cookies from the Canvas session without copying Canvas cookies', () => {
  const cookie = (domain, name, value) => ({ domain, path: '/', name, value });
  const merged = withSsoCookies(
    { cookies: [cookie('ems.colorado.edu', 'ASP.NET_SessionId', 'ems'), cookie('fedauth.colorado.edu', '__Host-shib_idp_session', 'old')], origins: [] },
    [
      cookie('fedauth.colorado.edu', '__Host-shib_idp_session', 'new'),
      cookie('.login.microsoftonline.com', 'ESTSAUTHPERSISTENT', 'ms'),
      cookie('canvas.colorado.edu', 'canvas_session', 'canvas'),
      cookie('.colorado.edu', '_ga', 'analytics')
    ]
  );
  assert.deepEqual(merged.cookies.map(c => `${c.domain} ${c.name}=${c.value}`), [
    'ems.colorado.edu ASP.NET_SessionId=ems',
    'fedauth.colorado.edu __Host-shib_idp_session=new',
    '.login.microsoftonline.com ESTSAUTHPERSISTENT=ms'
  ]);
});
