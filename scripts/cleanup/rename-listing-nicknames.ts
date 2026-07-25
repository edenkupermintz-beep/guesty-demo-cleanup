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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildNicknamePlan,
  type ListingScoreRow,
} from "../../src/cleanup/score-listing-nicknames.js";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

type ListingRow = ListingScoreRow;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadNicknameOptions() {
  const policyPath = resolve(
    ".cursor/skills/guesty-demo-cleanup/zero-state.json",
  );
  if (!existsSync(policyPath)) return {};
  try {
    const policy = JSON.parse(readFileSync(policyPath, "utf8")) as {
      listings?: {
        sharedNicknameCities?: string[];
        unitTypes?: string[];
        maxPreferredPerBaseNickname?: number;
      };
    };
    return {
      sharedNicknameCities: policy.listings?.sharedNicknameCities,
      unitTypes: policy.listings?.unitTypes,
      maxPreferredPerBaseNickname: policy.listings?.maxPreferredPerBaseNickname,
    };
  } catch {
    return {};
  }
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

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = await loadConfig();
  const listings = await fetchListings(config.baseUrl, config.accessToken);
  const { plan, missingCity } = buildNicknamePlan(listings, loadNicknameOptions());

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
