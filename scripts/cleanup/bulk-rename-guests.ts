/**
 * Bulk-rename demo guests: firstName/lastName only.
 * Does not touch email, phone, notes, reservations, or other fields.
 *
 * Prerequisites: guests-export.json (npm run cleanup:export-guests).
 *
 * Usage:
 *   npm run cleanup:rename-guests                 # dry-run → guest-rename-plan.json
 *   npm run cleanup:rename-guests -- --apply      # PUT names only
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

type GuestRow = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
};

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa",
  "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
  "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
  "Kenneth", "Dorothy", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa",
  "Timothy", "Deborah", "Ronald", "Stephanie", "Edward", "Rebecca", "Jason", "Sharon",
  "Jeffrey", "Laura", "Ryan", "Cynthia", "Jacob", "Kathleen", "Gary", "Amy",
  "Nicholas", "Angela", "Eric", "Shirley", "Jonathan", "Anna", "Stephen", "Brenda",
  "Larry", "Pamela", "Justin", "Emma", "Scott", "Nicole", "Brandon", "Helen",
  "Benjamin", "Samantha", "Samuel", "Katherine", "Raymond", "Christine", "Gregory", "Debra",
  "Frank", "Rachel", "Alexander", "Carolyn", "Patrick", "Janet", "Jack", "Catherine",
  "Dennis", "Maria", "Jerry", "Heather", "Tyler", "Diane", "Aaron", "Julie",
  "Jose", "Joyce", "Adam", "Victoria", "Nathan", "Kelly", "Henry", "Christina",
  "Douglas", "Joan", "Zachary", "Evelyn", "Peter", "Judith", "Kyle", "Megan",
  "Noah", "Cheryl", "Ethan", "Andrea", "Jeremy", "Hannah", "Walter", "Jacqueline",
  "Christian", "Martha", "Keith", "Gloria", "Roger", "Teresa", "Terry", "Sara",
  "Austin", "Janice", "Sean", "Marie", "Gerald", "Julia", "Carl", "Grace",
  "Dylan", "Judy", "Harold", "Theresa", "Jordan", "Madison", "Jesse", "Olivia",
  "Bryan", "Curtis", "Joel", "Natalie", "Arthur", "Amber", "Lawrence", "Danielle",
  "Joe", "Megan", "Willie", "Lauren", "Alan", "Victoria", "Juan", "Sophia",
  "Wayne", "Isabella", "Elijah", "Alexis", "Randy", "Alyssa", "Vincent", "Claire",
  "Mason", "Allison", "Roy", "Kathryn", "Ralph", "Jane", "Bobby", "Diana",
  "Bradley", "Brittany", "Russell", "Lori", "Miguel", "Tiffany", "Eugene", "Kayla",
  "Marcus", "Elena", "Priya", "Sofia", "Chloe", "Ava", "Mia", "Liam", "Owen",
  "Caleb", "Isaac", "Luke", "Leah", "Nora", "Hazel", "Violet", "Paisley", "Brooklyn",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
  "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker",
  "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris", "Morales", "Murphy",
  "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey",
  "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson",
  "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza",
  "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers",
  "Long", "Ross", "Foster", "Jimenez", "Powell", "Jenkins", "Perry", "Russell",
  "Sullivan", "Bell", "Coleman", "Butler", "Henderson", "Barnes", "Gonzales", "Fisher",
  "Vasquez", "Simmons", "Romero", "Jordan", "Patterson", "Alexander", "Hamilton", "Graham",
  "Reynolds", "Griffin", "Wallace", "Moreno", "West", "Cole", "Hayes", "Bryant",
  "Herrera", "Gibson", "Ellis", "Tran", "Medina", "Aguilar", "Stevens", "Murray",
  "Ford", "Castro", "Marshall", "Owen", "Harrison", "Fernandez", "Mcdonald", "Woods",
  "Washington", "Kennedy", "Wells", "Vargas", "Henry", "Chen", "Freeman", "Webb",
  "Tucker", "Guzman", "Burns", "Crawford", "Olson", "Simpson", "Porter", "Hunter",
  "Gordon", "Mendez", "Silva", "Shaw", "Snyder", "Mason", "Dixon", "Munoz",
  "Hunt", "Hicks", "Holmes", "Palmer", "Wagner", "Black", "Robertson", "Boyd",
  "Rose", "Stone", "Salazar", "Fox", "Warren", "Mills", "Meyer", "Rice",
  "Schmidt", "Keller", "Whitfield", "Blake", "Nielsen", "Hoffman", "Walsh", "Hansen",
];

const GROUP_LABELS = [
  "Wedding Party",
  "Team Trip",
  "Family Reunion",
  "Bachelor Party",
  "Bachelorette Weekend",
  "Corporate Retreat",
  "Birthday Weekend",
  "Anniversary Trip",
  "College Reunion",
  "Friends Getaway",
  "Ski Trip",
  "Beach Weekend",
  "Conference Group",
  "Graduation Trip",
  "Holiday Gathering",
];

const FORBIDDEN_SUBSTR = [
  "humberto",
  "rinaldi",
  "raftree",
  "remi",
  "rémi",
  "cannessant",
  "dervish",
  "maloney",
  "gomel",
];

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isGroupName(full: string): boolean {
  return /\bgroup\b/i.test(full) && /\bguest\s+\d+/i.test(full);
}

function loadAllowlistGuestIds(): Set<string> {
  const policyPath = resolve(
    ".cursor/skills/guesty-demo-cleanup/zero-state.json",
  );
  if (!existsSync(policyPath)) return new Set();
  try {
    const policy = JSON.parse(readFileSync(policyPath, "utf8")) as {
      guests?: { allowlistGuestIds?: string[] };
    };
    return new Set(policy.guests?.allowlistGuestIds ?? []);
  } catch {
    return new Set();
  }
}

function parseGroupIndex(full: string): number {
  const m = full.match(/guest\s+(\d+)\s*$/i);
  return m ? Number(m[1]) : 1;
}

function looksJunk(full: string, first: string, last: string): boolean {
  if (!full) return true;
  if (/^[\d\s]+$/.test(full)) return true;
  if (/\btest\b/i.test(full)) return true;
  if (/^(asdf|xxx|qwerty|foo|bar|n\/a|na)$/i.test(full)) return true;
  if (/^guest(\s+guest)?$/i.test(full)) return true;
  if (/^guesty/i.test(full)) return true;
  if (first.length <= 1 && last.length <= 1) return true;
  if (/^\d+$/.test(first) || /^\d+$/.test(last)) return true;
  return false;
}

function containsForbidden(full: string): boolean {
  const n = norm(full);
  return FORBIDDEN_SUBSTR.some((s) => n.includes(s));
}

function needsRename(g: GuestRow): boolean {
  const full = norm(g.fullName);
  const first = norm(g.firstName);
  const last = norm(g.lastName);
  if (containsForbidden(full) || containsForbidden(first) || containsForbidden(last)) return true;
  if (isGroupName(g.fullName ?? "")) return true;
  if (looksJunk(full, first, last)) return true;
  if (full === "david gomel") return true;
  if (full === "john doe" || full === "jane doe" || full === "john smith") return true;
  return false;
}

class NameFactory {
  private used = new Set<string>();
  private i = 0;
  private groupMap = new Map<string, string>();
  private groupLabelIdx = 0;

  constructor(existingKeep: string[]) {
    for (const n of existingKeep) this.used.add(norm(n));
  }

  private claim(first: string, last: string): { firstName: string; lastName: string } | null {
    const key = norm(`${first} ${last}`);
    if (this.used.has(key)) return null;
    if (containsForbidden(key)) return null;
    this.used.add(key);
    return { firstName: first, lastName: last };
  }

  nextPerson(): { firstName: string; lastName: string } {
    for (let attempt = 0; attempt < 20000; attempt++) {
      const first = FIRST_NAMES[this.i % FIRST_NAMES.length];
      const last = LAST_NAMES[Math.floor(this.i / FIRST_NAMES.length) % LAST_NAMES.length];
      this.i++;
      // slight scramble so consecutive guests differ more
      const f2 = FIRST_NAMES[(this.i * 7) % FIRST_NAMES.length];
      const l2 = LAST_NAMES[(this.i * 13) % LAST_NAMES.length];
      const hit = this.claim(f2, l2) ?? this.claim(first, last);
      if (hit) return hit;
    }
    throw new Error("Name pool exhausted");
  }

  nextGroup(originalFull: string): { firstName: string; lastName: string } {
    const n = norm(originalFull);
    // strip trailing guest N for prefix key
    const prefixKey = n.replace(/\s+guest\s+\d+\s*$/, "").trim();
    let label = this.groupMap.get(prefixKey);
    if (!label) {
      label = GROUP_LABELS[this.groupLabelIdx % GROUP_LABELS.length];
      this.groupLabelIdx++;
      this.groupMap.set(prefixKey, label);
    }
    const idx = parseGroupIndex(originalFull);
    const firstName = label;
    const lastName = `Guest ${idx}`;
    // Groups may intentionally share firstName prefix; uniqueness via first+last
    const key = norm(`${firstName} ${lastName}`);
    // Allow same "Wedding Party Guest 1" only once — if collision, suffix with letter
    if (!this.used.has(key)) {
      this.used.add(key);
      return { firstName, lastName };
    }
    for (let n2 = 2; n2 < 200; n2++) {
      const altLast = `Guest ${idx}${String.fromCharCode(64 + n2)}`; // 2->B? use -2
      const alt = `Guest ${idx}-${n2}`;
      const k2 = norm(`${firstName} ${alt}`);
      if (!this.used.has(k2)) {
        this.used.add(k2);
        return { firstName, lastName: alt };
      }
    }
    // fallback to person name
    return this.nextPerson();
  }
}

function loadGuests(): GuestRow[] {
  if (!existsSync("guests-export.json")) {
    throw new Error(
      "Missing guests-export.json. Run: npm run cleanup:export-guests",
    );
  }
  const raw = JSON.parse(readFileSync("guests-export.json", "utf8")) as {
    guests: GuestRow[];
  };
  return raw.guests;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const guests = loadGuests();
  const allowlist = loadAllowlistGuestIds();

  // Also treat high-duplicate non-forbidden names as needing unique renames
  const counts = new Map<string, number>();
  for (const g of guests) {
    const n = norm(g.fullName);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  const shouldRename = (g: GuestRow): boolean => {
    if (allowlist.has(g.id)) return false;
    if (needsRename(g)) return true;
    const n = norm(g.fullName);
    // Collapse heavy demo duplicates (>=5) into unique American names
    return (counts.get(n) ?? 0) >= 5;
  };

  // Keep names we are not rewriting so we don't collide with them
  const keepNames = guests
    .filter((g) => !shouldRename(g))
    .map((g) => g.fullName || `${g.firstName ?? ""} ${g.lastName ?? ""}`);

  const targets = guests.filter(shouldRename);

  const factory = new NameFactory(keepNames);
  const plan = targets.map((g) => {
    const full = g.fullName ?? "";
    const next = isGroupName(full)
      ? factory.nextGroup(full)
      : factory.nextPerson();
    return {
      id: g.id,
      before: {
        firstName: g.firstName,
        lastName: g.lastName,
        fullName: g.fullName,
      },
      after: next,
    };
  });

  writeFileSync(
    "guest-rename-plan.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apply,
        totalGuests: guests.length,
        renameCount: plan.length,
        plan,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        totalGuests: guests.length,
        renameCount: plan.length,
        sample: plan.slice(0, 8),
        planFile: "guest-rename-plan.json",
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.error("Dry-run only. Re-run with --apply to PUT firstName/lastName.");
    return;
  }

  const config = await loadConfig();
  const client = new GuestyWriteClient(config);
  let ok = 0;
  let fail = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    try {
      await client.sanitizeGuest(item.id, {
        firstName: item.after.firstName,
        lastName: item.after.lastName,
      });
      ok++;
    } catch (err) {
      fail++;
      failures.push({
        id: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if ((i + 1) % 50 === 0 || i === plan.length - 1) {
      console.error(`progress ${i + 1}/${plan.length} ok=${ok} fail=${fail}`);
    }
    await sleep(150);
  }

  writeFileSync(
    "guest-rename-results.json",
    JSON.stringify({ ok, fail, failures, completedAt: new Date().toISOString() }, null, 2),
  );
  console.log(JSON.stringify({ ok, fail, failureCount: failures.length }, null, 2));
  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
