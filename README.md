# CU Court Reserver

GitHub Actions requests a CU Recreation Center court in EMS each day shortly after midnight Denver time, for the next day's one-hour slot. The default is squash from 6–7 PM. If squash is unavailable, it books nothing by default and the failure email lists the open squash times; the settings page can instead opt in to the closest open squash time within 3 hours of the preferred time, and only if none fits, the first free badminton court (3C, 3A, then 3B) at the preferred time. If no court is available, the failure email alerts the configured contact. If the date is still unbooked, early-morning and four-hourly runs retry it; after a confirmation, those runs only refresh the session. A booking confirmation or failure sends email.

The public [GitHub Pages settings form](https://bug-swap.github.io/court-reserver/) chooses squash or badminton, the start time, and optionally badminton court 3A, 3B, or 3C. Settings are read from Supabase and saved through the `court-settings` Edge Function. Saving needs no sign-in: anyone with the page link can change the settings. The page also lists active and past reservations. Each successful run reads EMS **My Events** (upcoming plus the 15 most recent past) into `court_reservations`; until that table exists or has synced, the page falls back to `court_bookings`. The stored EMS confirmation text is never sent to the browser. The **Book a court now** card shows each court's free windows for today or tomorrow from `court_availability`, which every run refreshes and **Check EMS now** refreshes on demand through a `slots` run. Any 15-minute start that fits a window, counting EMS's 15-minute teardown after the hour, can be booked; that starts a `book` run for exactly that court and time, which re-checks EMS. Both need the `COURT_GITHUB_TOKEN` function secret: a fine-grained token with Actions read and write on this repository only. Booking emails for a confirmed or already-recorded date also list the squash court's open times that day. The page contains only Supabase's public anon key; the service key stays in server-side function secrets.

Supabase is the durable runtime store, shared with the `canvas-emailer` project but using only `court_*` tables. `court_session` contains an AES-256-GCM encrypted EMS browser session, `court_bookings` records successful dates to prevent duplicates, `court_runs` records outcomes, and `court_settings` stores the current booking choices. Canvas keeps its own session in the `canvas-session/session.json` Storage object; it does not read or overwrite `court_session`. Each court run reads (never writes) that object and takes only its CU SSO cookies (`fedauth.colorado.edu` and Microsoft sign-in), because Canvas's keepalive keeps them fresh. EMS's own `emsAuthToken` lasts only hours, so when EMS shows **Sign in** the runner clicks it and those SSO cookies sign it back in without a prompt. The independent `STATE_KEY` encrypts only the court session. Supabase Row Level Security is enabled for all court tables, and there are no public policies; the Edge Function uses its server-side key and validates settings before writing them.

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

The workflow runs Chromium headed under Xvfb because EMS returns an error page to headless Chromium. Court jobs start at :15 or :45 UTC to avoid starting at the same time as Canvas's top-of-hour and half-hour jobs; the midnight schedules cover Mountain daylight saving changes. GitHub scheduled jobs can be delayed, and EMS or Microsoft can expire a session despite keepalive visits. Check Actions for failures. If CU SSO itself expires, rerun canvas-emailer's login first; use `npm run login` only if EMS still cannot sign in. After a new login, update the `STATE_KEY` Actions secret to match the newly generated `state-key.txt`.

## Local checks

Run `npm test` for date and encryption behavior. To verify the EMS search and court selection locally after login, run `STATE_KEY="$(cat state-key.txt)" MODE=dry-run node --env-file=.env src/run.mjs`. Dry-run does not need contact details and does not fill or submit the reservation details form. It skips court selection when the target date is already recorded as booked.

If the headless dry run reaches an EMS error page while EMS works in your browser, try the same saved session in a visible browser with `STATE_KEY="$(cat state-key.txt)" HEADLESS=false MODE=dry-run node --env-file=.env src/run.mjs`. This still does not submit a reservation.
