# CU Court Reserver

This project uses Playwright and GitHub Actions to request a CU Recreation Center court in EMS. The default request is **squash, 6–7 PM Mountain time, one calendar day ahead**. The EMS court template currently allows bookings only one day ahead. Scheduled attempts start at 12:07 and 12:17 AM Denver time; later backup attempts may also run. Each run skips a date already recorded as booked. A separate scheduled run visits EMS every four hours. A successful reservation or a booking failure sends an email.

GitHub Pages hosts the settings form in `site/`. Choose squash or badminton, a one-hour start time, and optionally badminton court 3A, 3B, or 3C. Save writes `site/config.json` through GitHub's REST API using a fine-grained token entered on the page. The token must be limited to this repository with **Contents: Read and write** permission. The page clears the token field after the request and does not put it in browser storage, a URL, or the repository. GitHub Actions reads the saved config when booking. No EMS login session or contact information is committed to the repository.

## Initial setup

1. Install Node.js 22 or newer, run `npm ci`, then `npx playwright install chromium`.
2. Run `npm run login`. Sign in to CU EMS in the opened browser. When the signed-in home page displays **CREATE A RESERVATION**, return to the terminal and press Enter. This creates ignored `initial-state.txt` and `state-key.txt` files. Both are needed to use the session.
3. The public `Dracula-101/court-reserver` repository uses GitHub Pages with **GitHub Actions** as the source. Its code, schedule, and workflow logs are public; the site contains no login session or contact details.
4. Set repository Actions secrets:

   | Secret | Value |
   | --- | --- |
   | `STATE_KEY` | Entire contents of `state-key.txt` |
   | `EMS_INITIAL_STATE` | Entire contents of `initial-state.txt` |
   | `CONTACT_NAME` | Reservation contact name |
   | `CONTACT_PHONE` | Reservation contact phone |
   | `CONTACT_EMAIL` | Reservation contact and notification email |
   | `GMAIL_USER` | Gmail address that sends notifications |
   | `GMAIL_APP_PASSWORD` | Gmail app password for that account |

   Examples: `gh secret set STATE_KEY < state-key.txt` and `gh secret set EMS_INITIAL_STATE < initial-state.txt`. Enter the other secret values using `gh secret set NAME` so they do not appear in shell history.
5. Create a fine-grained GitHub token restricted to `Dracula-101/court-reserver` with **Contents: Read and write**. Enter it on the Pages form each time settings change; do not paste it into chat or commit it. Run **Reserve CU court** manually with `dry-run` to check the EMS form without submitting a reservation. If that succeeds, the scheduled booking and session refreshes are ready.

The workflow retains the latest browser session as an AES-256-GCM encrypted GitHub Actions artifact. Only the `STATE_KEY` secret decrypts it. The initial secret is used if no recent artifact exists. GitHub Actions schedules can be delayed, and CU or Microsoft may expire a session even when it is visited regularly. When that happens, run `npm run login` again, update both `STATE_KEY` and `EMS_INITIAL_STATE`, then delete the expired `ems-session` artifact or let it expire. A stale artifact takes precedence over the initial secret.

GitHub may disable scheduled workflows in an inactive public repository. Check the Actions page periodically. The page itself saves only settings; GitHub Actions executes bookings.

## Local checks

Run `npm test` for Denver date and daylight saving calculations. After `npm run login`, run `STATE_KEY="$(cat state-key.txt)" MODE=dry-run npm run run` to verify selectors before enabling the scheduled action. The dry run reaches the final form but does not press **Create Reservation**.
