import { writeFile } from 'node:fs/promises';
import { parseSettingsIssue } from './settings.mjs';

const body = process.env.ISSUE_BODY || '';
const settings = parseSettingsIssue(body);
await writeFile('site/config.json', JSON.stringify(settings, null, 2) + '\n');
console.log(`Validated ${settings.sport} at ${settings.startTime} Mountain time`);
