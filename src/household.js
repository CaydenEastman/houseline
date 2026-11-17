// Sharing a household with other people, leaving it, and deleting your account. All the rules are enforced on the
// server (see supabase/schema.sql); this file only calls those functions and tidies the phone afterwards.
const BUCKET = "photos";

export function photoIdsOf(state) {
  const ids = new Set();
  for (const x of [...((state && state.items) || []), ...((state && state.completions) || [])]) {
    for (const p of (x && x.photoIds) || []) if (typeof p === "string" && p) ids.add(p);
  }
  return [...ids];
}

/** Everything the person has in the app as one JSON text: the full backup plus every photo as image data. */
export async function exportEverything(state, getPhoto, exportJSON) {
  const obj = JSON.parse(exportJSON(state));
  const photos = {};
  for (const id of photoIdsOf(state)) {
    try { const d = await getPhoto(id); if (d) photos[id] = d; } catch { /* photo unavailable: skip it */ }
  }
  obj.photos = photos;
  obj.exportedAt = new Date().toISOString();
  return JSON.stringify(obj, null, 2);
}

/** Forget what this phone cached, so the next load shows what the cloud household has (never the old data). */
export function clearLocalCache(ls, storageKey, { everything = false } = {}) {
  const drop = [];
  try {
    for (let i = 0; i < (ls.length || 0); i++) { const k = ls.key(i); if (k && (k.startsWith("motH.photo.") || (everything && k.startsWith("motH.")))) drop.push(k); }
  } catch { /* ignore */ }
  for (const k of [storageKey, "motH.dirty", "motH.base", ...drop]) { try { ls.removeItem(k); } catch { /* ignore */ } }
}

export function createHousehold({ url, anonKey, auth, fetchImpl }) {
  const f = fetchImpl || ((...a) => fetch(...a));

  async function call(path, { method = "POST", body, rpc = true } = {}) {
    const token = await auth.accessToken();
    if (!token) throw new Error("Sign in first.");
    const res = await f(`${url}${path}`, {
      method,
      headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? (rpc ? "{}" : undefined) : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const msg = data && (data.message || data.error || data.msg);
      throw Object.assign(new Error(typeof msg === "string" && msg ? msg : `Something went wrong (${res.status}).`), { status: res.status });
    }
    return data;
  }
  const rpc = (name, args) => call(`/rest/v1/rpc/${name}`, { body: args || {} });

  return {
    info: () => rpc("household_info"),
    invite: (viewOnly) => rpc("create_invite", { view_only: !!viewOnly }),
    setEdit: (userId, allow) => rpc("set_member_edit", { target: userId, allow: !!allow }),
    cancelInvite: () => rpc("cancel_invite"),
    /** Join with a code. The server answers with a result (so a wrong try is still counted); a failure becomes a clear Error. */
    async accept(code) {
      const res = await rpc("accept_invite_v2", { invite_code: String(code || "") });
      if (res && res.error) throw Object.assign(new Error(res.message || "That code didn't work."), { code: res.error });
      return res && res.household_id;
    },
    leave: () => rpc("leave_household"),
    remove: (userId) => rpc("remove_member", { target: userId }),
    makeOwner: (userId) => rpc("make_owner", { target: userId }),
    privateGet: () => rpc("get_private_people"),
    privateSet: (pid, d) => rpc("set_private_person", { pid, d }),
    privateDelete: (pid) => rpc("delete_private_person", { pid }),
    snapshots: () => rpc("list_snapshots"),
    restoreSnapshot: (day) => rpc("restore_snapshot", { day }),

    /** Delete this household's photo files (only ever called when the person is alone in it). */
    async deletePhotoFiles(householdId) {
      for (let guard = 0; guard < 50; guard++) {
        const list = await call(`/storage/v1/object/list/${BUCKET}`, { body: { prefix: householdId, limit: 100, offset: 0 }, rpc: false });
        const names = (Array.isArray(list) ? list : []).filter((o) => o && o.name).map((o) => `${householdId}/${o.name}`);
        if (!names.length) return;
        await call(`/storage/v1/object/${BUCKET}`, { method: "DELETE", body: { prefixes: names }, rpc: false });
      }
    },

    /** Permanently delete the account. Photo files go first when nobody else shares the household. */
    async deleteAccount() {
      const info = await rpc("household_info");
      let photosRemoved = false;
      if (info && Array.isArray(info.members) && info.members.length === 1) { await this.deletePhotoFiles(info.household_id); photosRemoved = true; }
      try { await rpc("delete_my_account"); }
      catch (e) { throw Object.assign(e, { photosRemoved }); } // the photos are already gone: the screen must say so
    },
  };
}

/** What joining someone else's household would cost this person: nothing, or their own tasks and things. */
export function joinImpact(state) {
  const st = state || {};
  const n = (k) => (Array.isArray(st[k]) ? st[k].length : 0);
  const done = n("completions");
  const own = { tasks: n("tasks"), vehicles: n("vehicles"), items: n("items"), supplies: n("supplies"), vendors: n("vendors"), people: n("people") };
  // Only the starter list, nothing finished and nothing added by hand: there is nothing of theirs to lose.
  const untouched = done === 0 && !own.vehicles && !own.items && !own.supplies && !own.vendors && !own.people;
  const parts = [];
  const add = (c, word, many) => { if (c) parts.push(`${c} ${c === 1 ? word : many || word + "s"}`); };
  add(own.tasks, "task"); add(own.vehicles, "vehicle"); add(own.items, "home item"); add(own.supplies, "emergency supply", "emergency supplies"); add(own.vendors, "contact"); add(own.people, "family profile");
  if (done) parts.push(`${done} finished ${done === 1 ? "task" : "tasks"} in your history`);
  return { untouched, summary: parts.join(", "), counts: { ...own, completions: done } };
}

/** Friendly wording for things that go wrong while joining or managing a household. */
export function householdError(e, fallback = "That didn't work. Try again.") {
  const msg = e && e.message ? String(e.message) : "";
  if (!msg) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed|offline/i.test(msg)) return "You're offline. Connect to the internet and try again.";
  if (/not signed in|jwt|expired token/i.test(msg)) return "Please sign in again, then try once more.";
  return msg;
}

/** "k7m2 9qxr" -> "K7M2 9QXR": what the code box shows as someone types. */
export function formatCode(text) {
  const c = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}
