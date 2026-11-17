# Supabase setup (about 10 minutes, free tier)

1. Go to supabase.com, sign in, **New project**. Pick a name, a strong database password (save it in your password manager) and the region closest to you.
2. Open **SQL Editor, New query**, paste the whole of `supabase/schema.sql`, and click **Run**. It is safe to run again later.
3. Open **Project Settings, API** and copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public key** (the long `eyJ...` one, NOT the `service_role` key)
4. Put them in `config.js`:
   ```js
   export const SUPABASE_URL = "https://abcd1234.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   The anon key is meant to be public. The row-level security rules in `schema.sql` are what protect the data. **Never** put the `service_role` key anywhere in this repo.
5. **Authentication, URL Configuration**: set **Site URL** to your Pages address (`https://caydeneastman.github.io/man-of-the-house/`) and add the same address under **Redirect URLs**.
6. **Authentication, Sign In / Providers**: Email is on by default and is all you need to start. In the app, **You, Account** has an email box that sends a sign-in link.
   - Supabase's built-in email sender is limited to a few emails an hour. It is fine for you and family. For more, add your own SMTP under **Authentication, Emails, SMTP Settings** (Resend has a free tier).
   - **Google sign-in (optional):** in Google Cloud Console, **APIs & Services, Credentials, Create credentials, OAuth client ID**, type **Web application**. Add `https://<your-project>.supabase.co/auth/v1/callback` as an authorized redirect URI. Copy the client ID and secret into Supabase under **Authentication, Sign In / Providers, Google**, and turn it on. Until you do this, the "Continue with Google" button shows an error page; hide it by leaving that provider off and using email.
7. Recommended: **Authentication, Sign In / Providers**, turn **off** "Allow anonymous sign-ins", and decide whether to leave "Allow new users to sign up" on.
8. Commit and push `config.js`. Until a person signs in, the app keeps running in local mode.

Instant updates need nothing extra: `schema.sql` already adds the `docs` table to Supabase Realtime. If the live connection is ever blocked, the app falls back to checking every 20 seconds.

What gets created: tables `households`, `household_members`, `docs`, `locks`; a private `photos` storage bucket; and the rules that let a signed-in user reach only their own household.

## Morning push reminders (already set up for this project)

- Tables `push_subscriptions` (one row per phone, owner-only) and `push_config` (server-only: signing keys and a cron secret) are in the migration `push_reminders`.
- Edge Function `send-reminders` (no JWT; it checks the `x-cron-secret` header) runs hourly via pg_cron job `send-reminders-hourly`. The signing keys are created on first call and never leave the database; the public key is in `config.js` as `VAPID_PUBLIC_KEY`.
- To test without waiting for morning: turn reminders on in the app, then in the Supabase SQL editor run the `net.http_post` call to `/functions/v1/send-reminders?force=1` with the `x-cron-secret` header from `push_config`. Add `&dry=1` to preview without sending.

## Sharing a household

Owner: You, Settings, Account, Household, **Invite someone**, then send the 8-character code (one use, 7 days). Partner: sign in, then **Join with a code**. Joining replaces the joiner's own tasks with the household's, so they should download their data first if they want to keep it. Up to 6 people per household. Morning reminders go to every member who turned them on.

## Your own email sender (SMTP)

Supabase's built-in sender is for testing: it is limited to a few emails an hour and may land in spam. For real use:
1. Pick a sender. **Resend** is the simplest (free tier 3,000 emails/month). You need a domain you own so emails come from e.g. `hello@yourdomain.com`; without a domain, stay on the built-in sender.
2. In the sender, add your domain and the DNS records it shows, then create an API key (SMTP password).
3. In Supabase: **Authentication, Emails (or Project Settings, Authentication), SMTP Settings**, turn on **Custom SMTP**, and enter the sender address, name ("Man of the House"), host (`smtp.resend.com`), port `465`, username `resend`, and the API key as the password.
4. Authentication, Rate Limits: raise "emails per hour" to something sensible (e.g. 30).
5. Send yourself a sign-in link to test.

## Backups and crash reports

`schema.sql` creates nightly snapshots (14 days, documents only) and a `client_errors` table. After running it, schedule the jobs (the commented `cron.schedule` lines at the end of that section): `nightly-snapshots` and `prune-client-errors`. To read recent crashes: `select created_at, version, page, message from client_errors order by created_at desc limit 20;`

## Database checks

`supabase/tests/join_and_limits.test.sql` checks joining, the hourly try limit, direct-write refusals and the crash-report cap. Paste it in the SQL editor after `schema.sql`; it ends with a deliberate error so nothing is kept, and the expected result text is at the top of the file.
