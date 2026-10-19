import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBrowserState, restoreSessionStorage } from '../src/browser-state.mjs';

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
  let installed;
  await restoreSessionStorage({ addInitScript: async (script, storage) => { installed = { script, storage }; } }, { auth: 'opaque' });
  assert.deepEqual(installed.storage, { auth: 'opaque' });
});
