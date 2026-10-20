# CU Court Reserver

GitHub Actions requests a CU Recreation Center court in EMS each day shortly after midnight Denver time, for the next day's one-hour slot. The default is squash from 6–7 PM. If squash is unavailable, it tries badminton courts 3C, 3A, then 3B, booking only the first available court. If no court is available, the failure email alerts the configured contact. If the date is still unbooked, early-morning and four-hourly runs retry it; after a confirmation, those runs only refresh the session. A booking confirmation or failure sends email.

The public [GitHub Pages settings form](https://bug-swap.github.io/court-reserver/) chooses squash or badminton, the start time, and optionally badminton court 3A, 3B, or 3C. Settings are read from Supabase and saved through the `court-settings` Edge Function. Saving requires an emailed Supabase sign-in link, and the function accepts changes only from the configured reservation owner. The page contains only Supabase's public anon key; the service key stays in server-side function secrets.

Supabase is the durable runtime store, shared with the `canvas-emailer` project but using only `court_*` tables. `court_session` contains an AES-256-GCM encrypted EMS browser session, `court_bookings` records successful dates to prevent duplicates, `court_runs` records outcomes, and `court_settings` stores the current booking choices. Canvas keeps its own session in the `canvas-session/session.json` Storage object; it does not read or overwrite `court_session`. The projects use the same Supabase project, while EMS and Canvas browser sessions remain separate. The independent `STATE_KEY` encrypts only the court session. Supabase Row Level Security is enabled for all court tables, and there are no public policies; the Edge Function uses its server-side key and verifies the signed-in email before writing settings.

## Setup

1. In the same Supabase project used by `canvas-emailer`, run [supabase_schema.sql](supabase_schema.sql) in the SQL Editor. It creates only court-specific tables and leaves Canvas data alone.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to an ignored local `.env`. Use the same values as `canvas-emailer`. `SUPABASE_SERVICE_KEY` can be a current Supabase secret key or older `service_role` key. Never put it in `site/` or commit it.
3. Run `npm ci` and `npx playwright install chromium`. Then run `npm run login`; sign in to EMS and press Enter when **CREATE A RESERVATION** is visible. This creates ignored `initial-state.txt` and `state-key.txt`, and uploads the encrypted session to Supabase. Login capture is the only manual browser step. The school SSO session may still expire and require another capture.
4. Add repository Actions secrets:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Server-side Supabase secret key |
   | `STATE_KEY` | Entire contents of `state-key.txt` |
   | `CONTACT_NAME` | Reservation contact name |
   | `CONTACT_PHONE` | Reservation contact phone |
   | `CONTACT_EMAIL` | Reservation contact and notification email |
   | `GMAIL_USER` | Gmail address that sends notifications |
   | `GMAIL_APP_PASSWORD` | Gmail app password for that account |

   The older `EMS_INITIAL_STATE` secret is an optional fallback only when the Supabase session row is empty; it is no longer the primary state store. Add secrets with `gh secret set NAME` or in repository Settings. Do not paste values into chat.
5. Trigger **Reserve CU court** with `dry-run` to inspect the EMS form without submitting a reservation. Automatic booking uses the same selectors and submits on scheduled runs.

The workflow runs Chromium headed under Xvfb because EMS returns an error page to headless Chromium. Court jobs start at :15 or :45 UTC to avoid starting at the same time as Canvas's top-of-hour and half-hour jobs; the midnight schedules cover Mountain daylight saving changes. GitHub scheduled jobs can be delayed, and EMS or Microsoft can expire a session despite keepalive visits. Check Actions for failures and rerun `npm run login` when the session expires. After a new login, update the `STATE_KEY` Actions secret to match the newly generated `state-key.txt`.

## Local checks

Run `npm test` for date and encryption behavior. To verify the EMS search and court selection locally after login, run `STATE_KEY="$(cat state-key.txt)" MODE=dry-run node --env-file=.env src/run.mjs`. Dry-run does not need contact details and does not fill or submit the reservation details form. It skips court selection when the target date is already recorded as booked.

If the headless dry run reaches an EMS error page while EMS works in your browser, try the same saved session in a visible browser with `STATE_KEY="$(cat state-key.txt)" HEADLESS=false MODE=dry-run node --env-file=.env src/run.mjs`. This still does not submit a reservation.
