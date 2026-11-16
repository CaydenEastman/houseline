// Quick-add: turn "change furnace filter every 3 months" into a task. Pure; `today` is a parameter.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const UNIT_DAYS = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

const CAT_WORDS = {
  car: ["car", "truck", "van", "minivan", "suv", "oil", "tire", "tires", "brake", "brakes", "wiper", "wipers", "battery", "registration", "emissions", "coolant", "transmission", "trailer", "odometer", "alignment", "caravan", "equinox"],
  yard: ["lawn", "mow", "mower", "sprinkler", "sprinklers", "irrigation", "garden", "weed", "weeds", "fertilize", "fence", "tree", "trees", "hedge", "shrub", "shrubs", "mulch", "yard", "pool", "deck", "patio", "aerate"],
  emergency: ["emergency", "first aid", "flashlight", "flashlights", "supplies", "water storage", "generator", "go bag", "evacuation", "radio", "prep"],
};
const guessCategory = (t) => {
  const s = ` ${t.toLowerCase()} `;
  for (const cat of ["emergency", "car", "yard"]) if (CAT_WORDS[cat].some((w) => s.includes(` ${w} `) || s.includes(` ${w}s `))) return cat;
  return "house";
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s) => s.replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").replace(/\b(and|then|to|the)$/i, "").trim();

/** Returns { task, summary } or { error }. */
export function parseQuick(text, today) {
  if (typeof text !== "string" || !text.trim()) return { error: "Type what to do and how often, like \"clean gutters every 6 months\"." };
  let s = ` ${text.trim().replace(/\s+/g, " ")} `;
  const low = () => s.toLowerCase();
  let rest = null, interval = null, annual = null;

  // twice a year / semiannual
  let m = /\b(twice a year|twice yearly|semi-?annual(ly)?|every other month)\b/i.exec(s);
  if (m) { interval = /other month/i.test(m[0]) ? 61 : 182; s = s.replace(m[0], " "); }

  // "every 3 months", "every other week", "every year"
  if (interval == null) {
    m = /\bevery\s+(other\s+|(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+)?(day|week|month|quarter|year)s?\b/i.exec(s);
    if (m) {
      const unit = UNIT_DAYS[m[3].toLowerCase()];
      let n = 1;
      if (m[1]) n = /other/i.test(m[1]) ? 2 : (NUM_WORDS[m[2].toLowerCase()] ?? Number(m[2]));
      interval = n * unit;
      if (m[3].toLowerCase() === "year") interval = n * 365;
      s = s.replace(m[0], " ");
    }
  }
  // weekly / monthly / yearly ...
  if (interval == null) {
    m = /\b(daily|weekly|biweekly|monthly|quarterly|yearly|annually|annual)\b/i.exec(s);
    if (m) {
      interval = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365, annually: 365, annual: 365 }[m[1].toLowerCase()];
      s = s.replace(m[0], " ");
    }
  }
  // fixed date: "every March 15", "each October", "in March"
  if (interval == null) {
    const names = [...MONTHS, ...SHORT].join("|");
    m = new RegExp(`\\b(?:every|each|in|on)\\s+(${names})\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?\\b`, "i").exec(s);
    if (m) {
      const idx = MONTHS.findIndex((x) => x === m[1].toLowerCase() || x.slice(0, 3) === m[1].toLowerCase().slice(0, 3));
      const day = Math.min(28, Math.max(1, m[2] ? Number(m[2]) : 1));
      annual = { month: idx + 1, day };
      s = s.replace(m[0], " ");
    }
  }
  if (interval == null && !annual) return { error: "Say how often, like \"every 3 months\", \"weekly\" or \"every October\"." };
  if (interval != null && (interval < 1 || interval > 36500)) return { error: "That interval is out of range." };

  rest = clean(s);
  rest = rest.replace(/^(remind me to|remember to|please|to)\s+/i, "");
  if (!rest) return { error: "What should the task be called?" };
  if (rest.length > 120) rest = rest.slice(0, 120).trim();
  const title = cap(rest);
  const category = guessCategory(title);
  const task = annual
    ? { title, category, kind: "annual", month: annual.month, day: annual.day, custom: true }
    : { title, category, kind: "interval", intervalDays: interval, startDate: today, custom: true };
  const every = annual ? `every ${cap(MONTHS[annual.month - 1])} ${annual.day}` : describeInterval(interval);
  return { task, summary: `${title}: ${every} (${category})` };
}

export function describeInterval(n) {
  if (n === 1) return "every day";
  if (n % 365 === 0) return n === 365 ? "every year" : `every ${n / 365} years`;
  if (n === 7) return "every week";
  if (n % 7 === 0 && n < 60) return `every ${n / 7} weeks`;
  if (n === 30) return "every month";
  if (n === 91) return "every 3 months";
  if (n === 182) return "twice a year";
  if (n % 30 === 0 && n < 360) return `every ${n / 30} months`;
  return `every ${n} days`;
}
