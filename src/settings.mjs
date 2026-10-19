import { requestedRoom, requestedSport, requestedTime } from './config.mjs';

export function parseSettingsIssue(body) {
  const match = body.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!match) throw new Error('Settings issue has no JSON block');
  const submitted = JSON.parse(match[1]);
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new Error('Invalid settings');
  const keys = Object.keys(submitted).sort();
  if (keys.join(',') !== 'badmintonRoom,sport,startTime' || keys.some(key => typeof submitted[key] !== 'string')) {
    throw new Error('Settings must contain only sport, startTime, and badmintonRoom strings');
  }
  return {
    sport: requestedSport(submitted.sport),
    startTime: requestedTime(submitted.startTime),
    badmintonRoom: requestedRoom(submitted.badmintonRoom)
  };
}
