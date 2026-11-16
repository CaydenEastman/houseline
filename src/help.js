// Everything the app can show to help someone actually DO a task: how-to searches, the right manual, the vehicle's
// own specs, a short parts-and-steps list, and a few trusted pages. Pure functions, no clock and no network.
import { VEHICLE_SPECS } from "./logic.js";
import { howtoFor, normTitle } from "./howto.js";

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const web = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** "2015 Chevy Equinox" from year/make/model, falling back to whatever the person named the vehicle. */
export function vehicleLabel(v) {
  if (!v) return "";
  const l = [v.year, v.make, v.model].filter(Boolean).join(" ").trim();
  return l || String(v.name || "").trim();
}

const itemLabel = (it) => [it && it.name, it && it.model].filter((x) => x && String(x).trim()).join(" ");

/**
 * { links, specs, missingSpecs, need, steps, tip } for a task, or null when there is nothing useful to show.
 * links: [{ label, url, kind }] kind is "video" | "guide" | "manual" | "source".
 */
export function helpFor(task, state) {
  if (!task) return null;
  const s = state || {};
  const entry = howtoFor(task);
  const vehicle = task.vehicleId ? (s.vehicles || []).find((v) => v.id === task.vehicleId) || null : null;
  const item = task.itemId ? (s.items || []).find((i) => i.id === task.itemId) || null : null;
  if (!entry && !vehicle && !item) return null;

  const subject = vehicle ? vehicleLabel(vehicle) : itemLabel(item);
  const what = entry ? entry.q : `how to ${normTitle(task.title)}`;
  const query = (entry ? `how to ${what}` : what) + (subject ? ` ${subject}` : "");

  const links = [];
  if (entry || vehicle || item) {
    links.push({ kind: "video", label: "Watch a how-to video", url: yt(query) });
    if (entry) links.push({ kind: "guide", label: "Find a step-by-step guide", url: web(`${query} step by step`) });
  }
  if (vehicle) {
    links.push(vehicle.manualUrl
      ? { kind: "manual", label: "Your owner's manual", url: vehicle.manualUrl }
      : { kind: "manual", label: "Find the owner's manual", url: web(`${vehicleLabel(vehicle)} owner's manual pdf`) });
  } else if (item) {
    links.push(item.manualUrl
      ? { kind: "manual", label: `Manual for ${item.name}`, url: item.manualUrl }
      : { kind: "manual", label: "Find the manual", url: web(`${itemLabel(item)} manual pdf`) });
  }
  for (const src of entry ? entry.links : []) links.push({ kind: "source", label: src.label, url: src.url });

  const wanted = entry && entry.specs ? entry.specs : [];
  const specs = [];
  if (vehicle) {
    for (const key of wanted) {
      const meta = VEHICLE_SPECS.find((x) => x.key === key);
      if (meta && vehicle[key] && String(vehicle[key]).trim()) specs.push({ key, label: meta.label, value: String(vehicle[key]).trim() });
    }
  }
  const missingSpecs = vehicle ? wanted.filter((k) => !(vehicle[k] && String(vehicle[k]).trim())).length : 0;

  return {
    links, specs, missingSpecs, hasVehicle: !!vehicle,
    need: entry ? entry.need : [], steps: entry ? entry.steps : [], tip: entry ? entry.tip || "" : "",
  };
}
