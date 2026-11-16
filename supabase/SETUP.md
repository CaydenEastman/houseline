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
