import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptState, decryptState } from '../src/crypto.mjs';

test('session encryption rejects altered ciphertext', () => {
  process.env.STATE_KEY = 'a'.repeat(64);
  const encrypted = encryptState({ browserState: { cookies: [] }, bookedDates: [] });
  assert.deepEqual(decryptState(encrypted), { browserState: { cookies: [] }, bookedDates: [] });
  const changed = Buffer.from(encrypted, 'base64');
  changed[changed.length - 1] ^= 1;
  assert.throws(() => decryptState(changed.toString('base64')));
});
