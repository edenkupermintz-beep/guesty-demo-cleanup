/**
 * One-off: DELETE all listings whose nickname matches /nikos/i.
 * Children (MTL_CHILD) first, then parents (MTL). Requires --apply.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

type ListingRow = {
  _id: string;
  nickname?: string;
  title?: string;
  type?: string;
};

async function fetchListings(
  baseUrl: string,
  token: string,
): Promise<ListingRow[]> {
  const fields = encodeURIComponent("_id nickname title type");
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const delayMs = 150;
  const config = await loadConfig();
  const all = await fetchListings(config.baseUrl, config.accessToken);
  const matched = all.filter((l) => /nikos/i.test(l.nickname || ""));
  const byId = new Map<string, ListingRow>();
  for (const l of matched) byId.set(l._id, l);
  const unique = [...byId.values()];
  const children = unique.filter((l) => l.type === "MTL_CHILD");
  const parents = unique.filter((l) => l.type === "MTL");
  const other = unique.filter(
    (l) => l.type !== "MTL_CHILD" && l.type !== "MTL",
  );
  const ordered = [...children, ...other, ...parents];

  const plan = {
    createdAt: new Date().toISOString(),
    tokenConfigured: true,
    dryRun: !apply,
    totalMatched: unique.length,
    children: children.length,
    parents: parents.length,
    other: other.length,
    sample: ordered.slice(0, 8).map((l) => ({
      id: l._id,
      nickname: l.nickname,
      type: l.type,
    })),
  };

  writeFileSync(
    resolve(process.cwd(), "nikos-delete-plan.json"),
    JSON.stringify({ ...plan, ids: ordered.map((l) => l._id) }, null, 2),
  );
  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to DELETE.");
    return;
  }

  const client = new GuestyWriteClient(config);
  const results: Array<{
    id: string;
    nickname?: string;
    type?: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const l of ordered) {
    try {
      await client.deleteListing(l._id);
      results.push({ id: l._id, nickname: l.nickname, type: l.type, ok: true });
      console.error(`deleted ${l.type} ${l._id} ${l.nickname}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        id: l._id,
        nickname: l.nickname,
        type: l.type,
        ok: false,
        error: msg,
      });
      console.error(`FAILED ${l._id}: ${msg}`);
    }
    await sleep(delayMs);
  }

  const summary = {
    tokenConfigured: true,
    attempted: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failures: results.filter((r) => !r.ok).slice(0, 20),
  };
  writeFileSync(
    resolve(process.cwd(), "nikos-delete-results.json"),
    JSON.stringify({ ...summary, results }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
