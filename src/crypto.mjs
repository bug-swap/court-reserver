import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const raw = process.env.STATE_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('STATE_KEY must be 64 hex characters');
  return Buffer.from(raw, 'hex');
}

export function encryptState(state) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('CR1'), iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptState(encoded) {
  const payload = Buffer.from(encoded.trim(), 'base64');
  if (payload.subarray(0, 3).toString() !== 'CR1') throw new Error('Invalid session file');
  const iv = payload.subarray(3, 15);
  const tag = payload.subarray(15, 31);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(31)), decipher.final()]).toString('utf8'));
}
