# CU Court Reserver

This project uses Playwright and GitHub Actions to request a CU Recreation Center court in EMS. The default request is **squash, 6–7 PM Mountain time, two calendar days ahead**. `SPORT=badminton` and `START_TIME=06:00` change those defaults. The scheduled run starts at 12:07 AM Denver time and a separate scheduled run visits EMS every four hours. A successful reservation or a booking failure sends an email.

GitHub Pages hosts only the informational page in `site/`. GitHub Actions runs the automation. No login session or contact information is stored in the site or committed to the repository.

## Initial setup

1. Install Node.js 22 or newer, run `npm ci`, then `npx playwright install chromium`.
2. Run `npm run login`. Sign in to CU EMS in the opened browser. When the signed-in home page displays **CREATE A RESERVATION**, return to the terminal and press Enter. This creates an encrypted, ignored `initial-state.txt` and prints a 64-character `STATE_KEY`.
3. Create a **private** GitHub repository for this project and enable GitHub Pages with **GitHub Actions** as the source. A private repository keeps workflow logs and session artifacts restricted. Confirm that the account's plan supports Pages for private repositories; if not, leave Pages disabled rather than making the session workflow public.
4. Set repository Actions secrets:

   | Secret | Value |
   | --- | --- |
   | `STATE_KEY` | Key printed by `npm run login` |
   | `EMS_INITIAL_STATE` | Entire contents of `initial-state.txt` |
   | `CONTACT_NAME` | Reservation contact name |
   | `CONTACT_PHONE` | Reservation contact phone |
   | `CONTACT_EMAIL` | Reservation contact and notification email |
   | `GMAIL_USER` | Gmail address that sends notifications |
   | `GMAIL_APP_PASSWORD` | Gmail app password for that account |

   Example: `gh secret set EMS_INITIAL_STATE < initial-state.txt`. Enter the other secret values using `gh secret set NAME` so they do not appear in shell history.
5. Push the `main` branch. Run **Reserve CU court** manually with `dry-run` to check the EMS form without submitting a reservation. If that succeeds, the scheduled booking and session refreshes are ready.

The workflow retains the latest browser session as an AES-256-GCM encrypted GitHub Actions artifact. Only the `STATE_KEY` secret decrypts it. The initial secret is used if no recent artifact exists. GitHub Actions schedules can be delayed, and CU or Microsoft may expire a session even when it is visited regularly. When that happens, run `npm run login` again and update `EMS_INITIAL_STATE`, then delete the expired `ems-session` artifact or let it expire. A stale artifact takes precedence over the initial secret.

GitHub may disable scheduled workflows in an inactive public repository. Check the Actions page periodically. The page itself cannot execute bookings.

## Local checks

Run `npm test` for Denver date and daylight saving calculations. Run `MODE=dry-run STATE_KEY=... npm run run` after `npm run login` to verify selectors before enabling the scheduled action. The dry run reaches the final form but does not press **Create Reservation**.
