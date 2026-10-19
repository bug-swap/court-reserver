import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettingsIssue } from '../src/settings.mjs';

test('accepts a page-generated settings request and rejects extra fields', () => {
  const valid = 'Settings\n```json\n{"sport":"badminton","startTime":"18:30","badmintonRoom":"3B"}\n```';
  assert.deepEqual(parseSettingsIssue(valid), { sport: 'badminton', startTime: '18:30', badmintonRoom: '3B' });
  assert.throws(() => parseSettingsIssue(valid.replace('"3B"', '"3D"')));
  assert.throws(() => parseSettingsIssue(valid.replace('"3B"', '"3B","extra":"value"')));
});
