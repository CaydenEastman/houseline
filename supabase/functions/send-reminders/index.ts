// Man of the House: morning push reminders (deployed as the Supabase Edge Function "send-reminders", no JWT).
// Called once an hour by pg_cron with the shared secret in the x-cron-secret header. For each subscribed phone whose
// local morning has arrived, it works out what is overdue or due today and sends a Web Push notification.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { dueInfo, reminderState, localParts, isQuietDay } from "./due.js";

const SITE = "https://caydeneastman.github.io/man-of-the-house/";
const WINDOW_HOURS = 4; // if the hourly job was late or missed, still send within 4 hours after the chosen hour

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function same(a: string, b: string) { // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function summary(userId: string, today: string) {
  const { data: mem } = await sb.from("household_members").select("household_id").eq("user_id", userId).limit(1);
  const hh = mem && mem[0] && mem[0].household_id;
  if (!hh) return null;
  const { data: doc } = await sb.from("docs").select("data").eq("household_id", hh).eq("path", "household/main").limit(1);
  const state = doc && doc[0] && doc[0].data;
  if (!state || !Array.isArray(state.tasks)) return null;
  let overdue = 0, due = 0, top: string | null = null, topDays = Infinity;
  for (const t of state.tasks) {
    if (t.snoozedUntil != null && t.snoozedUntil > today) continue;
    let d; try { d = dueInfo(t, state, today); } catch { continue; }
    if (d.daysUntil == null) continue;
    if (d.daysUntil < 0) overdue++; else if (d.daysUntil === 0) due++;
    if (d.daysUntil <= 0 && d.daysUntil < topDays) { topDays = d.daysUntil; top = String(t.title); }
  }
  const parts: string[] = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (due) parts.push(`${due} due today`);
  return { overdue, due, message: parts.length ? `${parts.join(" and ")}. Most urgent: ${top}` : null };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const { data: cfg } = await sb.from("push_config").select("*").eq("id", 1).single();
    if (!cfg || !same(req.headers.get("x-cron-secret") ?? "", cfg.cron_secret)) return json({ error: "forbidden" }, 403);

    // One-time (idempotent) setup: make the signing keys. The private key never leaves the database.
    if (!cfg.vapid_public || !cfg.vapid_private) {
      const k = webpush.generateVAPIDKeys();
      await sb.from("push_config").update({ vapid_public: k.publicKey, vapid_private: k.privateKey }).eq("id", 1);
      cfg.vapid_public = k.publicKey; cfg.vapid_private = k.privateKey;
    }
    if (url.searchParams.get("action") === "init") return json({ publicKey: cfg.vapid_public });

    webpush.setVapidDetails(SITE, cfg.vapid_public, cfg.vapid_private);
    const dry = url.searchParams.get("dry") === "1";
    const force = url.searchParams.get("force") === "1"; // testing only: ignore the morning window

    const { data: subs, error } = await sb.from("push_subscriptions").select("*").limit(5000);
    if (error) return json({ error: error.message }, 500);
    const out = { checked: 0, quiet: 0, sent: 0, nothingDue: 0, notYet: 0, removed: 0, failed: 0, would: [] as string[] };

    for (const s of subs ?? []) {
      out.checked++;
      let tz = s.tz; try { localParts(tz); } catch { tz = "UTC"; }
      const lp = localParts(tz);
      const rs = reminderState(tz, s.hour, s.last_sent_on, WINDOW_HOURS);
      if (!force && !rs.due) { out.notYet++; continue; }
      if (!force && isQuietDay(s.quiet_days, rs.day)) {
        out.quiet++;
        if (!dry) await sb.from("push_subscriptions").update({ last_sent_on: rs.day }).eq("endpoint", s.endpoint);
        continue;
      }
      const sum = await summary(s.user_id, lp.date);
      if (!sum || !sum.message) {
        out.nothingDue++;
        if (!dry) await sb.from("push_subscriptions").update({ last_sent_on: rs.day }).eq("endpoint", s.endpoint);
        continue;
      }
      if (dry) { out.would.push(sum.message); continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: "Man of the House", body: `${sum.message}`, url: SITE }),
          { TTL: 12 * 3600, urgency: "normal" },
        );
        out.sent++;
        await sb.from("push_subscriptions").update({ last_sent_on: rs.day }).eq("endpoint", s.endpoint);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); out.removed++; }
        else out.failed++;
      }
    }
    return json(out);
  } catch (e) {
    console.error("send-reminders failed", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
