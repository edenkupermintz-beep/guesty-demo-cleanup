/**
 * Rename listing nicknames to GueStay - {City}[- {UnitType}].
 * Does NOT change titles (marketing titles stay as-is).
 *
 * Rules:
 * - One listing in a city → `GueStay - {City}`
 * - Multiples → `GueStay - {City} - {UnitType}` (Apartment, Condo, Loft, …)
 * - Shared multi-unit cities (default: Atlanta) → all `GueStay - {City}` (no unit type)
 * - Guesty requires unique nicknames — append ` 2`, ` 3`, … when needed
 *
 * Usage:
 *   npm run cleanup:rename-listing-nicknames
 *   npm run cleanup:rename-listing-nicknames -- --apply
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

const UNIT_TYPES = [
  "Apartment",
  "Condo",
  "Loft",
  "Penthouse",
  "Studio",
  "Suite",
  "Townhouse",
  "Villa",
  "House",
  "Cottage",
  "Duplex",
  "Cabin",
  "Flat",
  "Bungalow",
] as const;

/** Cities whose units share one nickname (multi-unit children). */
const SHARED_NICKNAME_CITIES = new Set(["atlanta"]);

type ListingRow = {
  _id: string;
  title?: string;
  nickname?: string;
  propertyType?: string;
  roomType?: string;
  address?: { city?: string; full?: string };
};

type PlanRow = {
  id: string;
  title: string | null;
  city: string;
  before: string | null;
  after: string;
  unitType: string | null;
  sharedMultiUnit: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function titleCaseCity(city: string): string {
  return city
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (/^(dc|nyc|la|sf|uk)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function inferUnitType(l: ListingRow): string | null {
  const blob = `${l.title || ""} ${l.nickname || ""} ${l.propertyType || ""} ${l.roomType || ""}`.toLowerCase();
  const hints: Array<[RegExp, string]> = [
    [/penthouse/, "Penthouse"],
    [/studio/, "Studio"],
    [/loft/, "Loft"],
    [/town\s*house|townhome/, "Townhouse"],
    [/villa/, "Villa"],
    [/cottage/, "Cottage"],
    [/cabin/, "Cabin"],
    [/bungalow/, "Bungalow"],
    [/duplex/, "Duplex"],
    [/suite/, "Suite"],
    [/condo|condominium/, "Condo"],
    [/apartment|apt\b|flat\b/, "Apartment"],
    [/house|home/, "House"],
  ];
  for (const [re, label] of hints) if (re.test(blob)) return label;
  return null;
}

function guessCityFromFull(full?: string): string | null {
  if (!full) return null;
  if (/\bLondon\b/i.test(full)) return "London";
  if (/\bSão Paulo\b|\bSao Paulo\b/i.test(full)) return "São Paulo";
  if (/\bNatal\b/i.test(full)) return "Natal";
  return null;
}

function fitNickname(city: string, unitType?: string | null): string {
  const c = titleCaseCity(city);
  const name = unitType ? `GueStay - ${c} - ${unitType}` : `GueStay - ${c}`;
  return name.slice(0, 80);
}

function uniquify(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let n = 2; n < 200; n++) {
    const cand = `${base} ${n}`;
    if (!used.has(cand) && cand.length <= 80) return cand;
  }
  throw new Error(`Could not uniquify nickname: ${base}`);
}

async function fetchListings(
  baseUrl: string,
  token: string,
): Promise<ListingRow[]> {
  const fields = encodeURIComponent(
    "_id title nickname propertyType roomType address.city address.full",
  );
  const listings: ListingRow[] = [];
  let skip = 0;
  for (;;) {
    const res = await fetch(
      `${baseUrl}/listings?fields=${fields}&limit=100&skip=${skip}&sort=title`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Guesty ${res.status} listing list: ${(await res.text()).slice(0, 400)}`);
    }
    const data = (await res.json()) as { results?: ListingRow[]; data?: ListingRow[] };
    const page = data.results ?? data.data ?? [];
    listings.push(...page);
    if (page.length < 100) break;
    skip += 100;
  }
  return listings;
}

function buildPlan(listings: ListingRow[]): {
  plan: PlanRow[];
  missingCity: Array<{ id: string; title?: string; nickname?: string }>;
} {
  const enriched = listings.map((l) => ({
    l,
    city: (l.address?.city || "").trim() || guessCityFromFull(l.address?.full) || "",
  }));

  const byCity = new Map<string, typeof enriched>();
  for (const row of enriched) {
    const key = row.city ? titleCaseCity(row.city) : "";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(row);
  }

  const plan: PlanRow[] = [];
  const missingCity: Array<{ id: string; title?: string; nickname?: string }> = [];
  const reserved = new Set<string>();

  for (const [cityKey, rows] of byCity) {
    if (!cityKey) {
      for (const { l } of rows) {
        missingCity.push({ id: l._id, title: l.title, nickname: l.nickname });
      }
      continue;
    }

    const shareSame =
      SHARED_NICKNAME_CITIES.has(cityKey.toLowerCase()) || rows.length === 1;

    if (shareSame) {
      for (const { l } of rows) {
        const base = fitNickname(cityKey);
        const after = uniquify(base, reserved);
        reserved.add(after);
        if ((l.nickname || "") === after) continue;
        plan.push({
          id: l._id,
          title: l.title ?? null,
          city: cityKey,
          before: l.nickname ?? null,
          after,
          unitType: null,
          sharedMultiUnit: SHARED_NICKNAME_CITIES.has(cityKey.toLowerCase()),
        });
      }
      continue;
    }

    const typeCounts = new Map<string, number>();
    let typeIdx = 0;
    for (const row of rows) {
      let unitType = inferUnitType(row.l);
      if (unitType && (typeCounts.get(unitType) || 0) >= 3) unitType = null;
      if (!unitType) {
        for (let n = 0; n < UNIT_TYPES.length * 3; n++) {
          const cand = UNIT_TYPES[typeIdx % UNIT_TYPES.length];
          typeIdx++;
          if ((typeCounts.get(cand) || 0) < 3) {
            unitType = cand;
            break;
          }
        }
      }
      unitType = unitType || "Apartment";
      typeCounts.set(unitType, (typeCounts.get(unitType) || 0) + 1);
      const base = fitNickname(cityKey, unitType);
      const after = uniquify(base, reserved);
      reserved.add(after);
      if ((row.l.nickname || "") === after) continue;
      plan.push({
        id: row.l._id,
        title: row.l.title ?? null,
        city: cityKey,
        before: row.l.nickname ?? null,
        after,
        unitType,
        sharedMultiUnit: false,
      });
    }
  }

  return { plan, missingCity };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = await loadConfig();
  const listings = await fetchListings(config.baseUrl, config.accessToken);
  const { plan, missingCity } = buildPlan(listings);

  const payload = {
    createdAt: new Date().toISOString(),
    apply,
    totalListings: listings.length,
    renameCount: plan.length,
    missingCity: missingCity.length,
    missingCitySample: missingCity.slice(0, 10),
    sample: plan.slice(0, 12),
    plan,
  };
  writeFileSync("listing-nickname-plan.json", JSON.stringify(payload, null, 2));

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        totalListings: listings.length,
        renameCount: plan.length,
        missingCity: missingCity.length,
        sample: plan.slice(0, 8),
        planFile: "listing-nickname-plan.json",
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.error("Dry-run only. Re-run with --apply to PUT nickname (titles untouched).");
    return;
  }

  const client = new GuestyWriteClient(config);
  let ok = 0;
  let fail = 0;
  const failures: Array<{ id: string; after: string; error: string }> = [];

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    let attempt = 0;
    let nickname = item.after;
    for (;;) {
      attempt++;
      try {
        await client.updateListingNickname(item.id, nickname);
        ok++;
        item.after = nickname;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") && attempt < 8) {
          await sleep(1500 * attempt);
          continue;
        }
        if (msg.includes("already exists") && attempt < 6) {
          nickname = `${item.after} ${attempt + 1}`.slice(0, 80);
          continue;
        }
        fail++;
        failures.push({ id: item.id, after: nickname, error: msg });
        break;
      }
    }
    if ((i + 1) % 20 === 0 || i === plan.length - 1) {
      console.error(`progress ${i + 1}/${plan.length} ok=${ok} fail=${fail}`);
    }
    await sleep(400);
  }

  writeFileSync(
    "listing-nickname-results.json",
    JSON.stringify({ ok, fail, failures, completedAt: new Date().toISOString() }, null, 2),
  );
  // Refresh plan file with final after values (for revert)
  writeFileSync(
    "listing-nickname-plan.json",
    JSON.stringify({ ...payload, plan, apply: true }, null, 2),
  );

  console.log(JSON.stringify({ ok, fail, failureCount: failures.length }, null, 2));
  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
