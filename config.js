// Supabase project for this app. Both values are PUBLIC by design: the anon key only works together with the
// row-level security rules in supabase/schema.sql. NEVER put the service_role key in this repo.
// Leave them empty to run in local-only mode (data stays in this browser).
export const SUPABASE_URL = "https://qaaimydozxrosfxqdnzx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhYWlteWRvenhyb3NmeHFkbnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NTg3MzgsImV4cCI6MjExMDQzNDczOH0.PNVVzvrxD8oaqSjLmHCJSvYjEEpFk1KE70PO3z4AnEU";

// Public key for morning push reminders (safe to publish; the matching private key lives only in the database).
export const VAPID_PUBLIC_KEY = "BLis6SpvNyNithh5y7XjubP1LfK9oV1wkqAUKzJyJg8DwgFJFbyL6D7g3fp8ffonKDbDEBYf5wWQv361yt5SupI";
