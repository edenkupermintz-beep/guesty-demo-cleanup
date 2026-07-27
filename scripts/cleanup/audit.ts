/**
 * Apprentice audit: measure dirty guests / nicknames / tasks vs zero-state thresholds.
 * Read-only. Writes audit-report.json. Never applies mutations.
 *
 * Usage: npm run cleanup:audit
 *        npm run cleanup:audit -- --force-refresh
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAuditReport } from "../../src/cleanup/audit.js";
import { scoreCustomFields } from "../../src/cleanup/score-custom-fields.js";
import { scoreGuests } from "../../src/cleanup/score-guests.js";
import {
  scoreListingNicknames,
  type ListingScoreRow,
} from "../../src/cleanup/score-listing-nicknames.js";
import { scoreTasks } from "../../src/cleanup/score-tasks.js";
import {
  loadZeroState,
  resolveAuditConfig,
  resolveCustomFieldsCatalog,
} from "../../src/cleanup/zero-state.js";
import { hasGuestyAuthConfigured, loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

function hoursAgo(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ms / (1000 * 60 * 60);
}

function isFresh(fetchedAt: string | undefined, maxAgeHours: number): boolean {
  const age = hoursAgo(fetchedAt);
  return age != null && age <= maxAgeHours;
}

async function guestyGetJson<T>(
  baseUrl: string,
  token: string,
  pathAndQuery: string,
): Promise<T> {
  const url = `${baseUrl}${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Guesty ${res.status} ${res.statusText} for ${pathAndQuery}: ${body.slice(0, 400)}`,
    );
  }
  return (await res.json()) as T;
}

async function ensureGuestsExport(
  baseUrl: string,
  token: string,
  maxAgeHours: number,
  force: boolean,
): Promise<{ guests: Array<{
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}>; fetchedAt?: string; reused: boolean }> {
  const path = resolve(process.cwd(), "guests-export.json");
  if (!force && existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      fetchedAt?: string;
      guests: Array<{
        id: string;
        fullName: string | null;
        firstName: string | null;
        lastName: string | null;
      }>;
    };
    if (isFresh(raw.fetchedAt, maxAgeHours) && Array.isArray(raw.guests)) {
      return { guests: raw.guests, fetchedAt: raw.fetchedAt, reused: true };
    }
  }

  const fields = encodeURIComponent("_id fullName firstName lastName email phone");
  const pageSize = 100;
  const guests: Array<{
    id: string;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  }> = [];
  let skip = 0;
  for (;;) {
    const data = await guestyGetJson<{
      results?: Array<{
        _id?: string;
        id?: string;
        fullName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }>;
      data?: Array<{
        _id?: string;
        id?: string;
        fullName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }>;
    }>(baseUrl, token, `/guests?fields=${fields}&limit=${pageSize}&skip=${skip}`);
    const page = data.results ?? data.data ?? [];
    for (const g of page) {
      const id = g._id ?? g.id;
      if (!id) continue;
      guests.push({
        id,
        fullName: g.fullName ?? null,
        firstName: g.firstName ?? null,
        lastName: g.lastName ?? null,
      });
    }
    console.error(`guests fetched ${guests.length}`);
    if (page.length < pageSize) break;
    skip += pageSize;
  }

  const fetchedAt = new Date().toISOString();
  writeFileSync(
    path,
    JSON.stringify({ total: guests.length, fetchedAt, guests }, null, 2),
  );
  return { guests, fetchedAt, reused: false };
}

async function ensureTasksExport(
  baseUrl: string,
  token: string,
  maxAgeHours: number,
  force: boolean,
): Promise<{ tasks: unknown[]; fetchedAt?: string; reused: boolean }> {
  const path = resolve(process.cwd(), "tasks-export.json");
  if (!force && existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      fetchedAt?: string;
      tasks: unknown[];
    };
    if (isFresh(raw.fetchedAt, maxAgeHours) && Array.isArray(raw.tasks)) {
      return { tasks: raw.tasks, fetchedAt: raw.fetchedAt, reused: true };
    }
  }

  const fields = [
    "_id",
    "title",
    "status",
    "type",
    "listingId",
    "reservationId",
    "createdAt",
    "updatedAt",
  ].join(" ");
  const tasks: unknown[] = [];
  let skip = 0;
  const pageSize = 100;
  for (;;) {
    const data = await guestyGetJson<{
      results?: unknown[];
      data?: unknown[];
    }>(
      baseUrl,
      token,
      `/tasks?fields=${encodeURIComponent(fields)}&limit=${pageSize}&skip=${skip}`,
    );
    const page = data.results || data.data || [];
    tasks.push(...page);
    if (tasks.length % 1000 === 0 || page.length < pageSize) {
      console.error(`tasks fetched ${tasks.length}`);
    }
    if (page.length < pageSize) break;
    skip += pageSize;
    if (skip > 100_000) throw new Error(`safety stop at skip=${skip}`);
  }

  const fetchedAt = new Date().toISOString();
  writeFileSync(
    path,
    JSON.stringify({ total: tasks.length, fetchedAt, tasks }, null, 2),
  );
  return { tasks, fetchedAt, reused: false };
}

async function fetchListings(
  baseUrl: string,
  token: string,
): Promise<ListingScoreRow[]> {
  const fields = encodeURIComponent(
    "_id title nickname propertyType roomType address.city address.full",
  );
  const listings: ListingScoreRow[] = [];
  let skip = 0;
  for (;;) {
    const data = await guestyGetJson<{
      results?: ListingScoreRow[];
      data?: ListingScoreRow[];
    }>(baseUrl, token, `/listings?fields=${fields}&limit=100&skip=${skip}&sort=title`);
    const page = data.results ?? data.data ?? [];
    listings.push(...page);
    if (page.length < 100) break;
    skip += 100;
  }
  return listings;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force-refresh");
  if (!hasGuestyAuthConfigured()) {
    throw new Error(
      "Missing Guesty auth. Set GUESTY_ACCESS_TOKEN or GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env.",
    );
  }

  const zs = loadZeroState();
  const auditCfg = resolveAuditConfig(zs);
  const config = await loadConfig();

  console.error(
    `audit thresholds: guests>=${auditCfg.thresholds.guestsRenameCount} nicknames>=${auditCfg.thresholds.listingNicknameRenameCount} tasks>=${auditCfg.thresholds.tasksDeleteCount} customFields>=${auditCfg.thresholds.customFieldsDirtyCount} (exportMaxAgeHours=${auditCfg.exportMaxAgeHours})`,
  );

  const guestsExport = await ensureGuestsExport(
    config.baseUrl,
    config.accessToken,
    auditCfg.exportMaxAgeHours,
    force,
  );
  console.error(
    `guests: ${guestsExport.reused ? "reused export" : "fresh export"} (${guestsExport.guests.length})`,
  );

  const guestScore = scoreGuests(guestsExport.guests, {
    allowlistGuestIds: zs.guests?.allowlistGuestIds,
    duplicateFullNameThreshold: zs.guests?.duplicateFullNameThreshold ?? 5,
    forbiddenNameSubstrings: zs.guests?.forbiddenNameSubstrings,
  });

  const listings = await fetchListings(config.baseUrl, config.accessToken);
  console.error(`listings fetched ${listings.length}`);
  const nicknameScore = scoreListingNicknames(listings, {
    sharedNicknameCities: zs.listings?.sharedNicknameCities,
    unitTypes: zs.listings?.unitTypes,
    maxPreferredPerBaseNickname: zs.listings?.maxPreferredPerBaseNickname,
  });

  const tasksExport = await ensureTasksExport(
    config.baseUrl,
    config.accessToken,
    auditCfg.exportMaxAgeHours,
    force,
  );
  console.error(
    `tasks: ${tasksExport.reused ? "reused export" : "fresh export"} (${tasksExport.tasks.length})`,
  );
  const taskScore = scoreTasks(tasksExport.tasks as Parameters<typeof scoreTasks>[0], {
    keepPerTitle: zs.tasks?.keepPerTitle ?? 50,
    keepableStatuses: zs.tasks?.keepableStatuses,
  });

  const writeClient = new GuestyWriteClient(config);
  const { id: accountId } = await writeClient.getAccountMe();
  const liveCustomFields = await writeClient.listCustomFields(accountId);
  const catalog = resolveCustomFieldsCatalog(zs);
  console.error(
    `customFields: account=${accountId} live=${liveCustomFields.length} catalog=${catalog.length}`,
  );
  const customFieldScore = scoreCustomFields(liveCustomFields, catalog);

  const report = buildAuditReport({
    thresholds: auditCfg.thresholds,
    guests: {
      renameCount: guestScore.renameCount,
      totalGuests: guestScore.totalGuests,
      sample: guestScore.sample,
    },
    listingNicknames: {
      renameCount: nicknameScore.renameCount,
      totalListings: nicknameScore.totalListings,
      missingCity: nicknameScore.missingCity,
      sample: nicknameScore.sample,
    },
    tasks: {
      deleteCount: taskScore.deleteCount,
      keep: taskScore.keep,
      keepableCandidates: taskScore.keepableCandidates,
      keepPerTitle: taskScore.keepPerTitle,
      exported: taskScore.exported,
      topDeleteTitles: taskScore.topDeleteTitles,
    },
    customFields: {
      dirtyCount: customFieldScore.dirtyCount,
      liveCount: customFieldScore.liveCount,
      catalogCount: customFieldScore.catalogCount,
      keep: customFieldScore.keep,
      sample: customFieldScore.sample,
    },
    inboxNote: zs.inbox?.note,
  });

  const outPath = resolve(process.cwd(), "audit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        tokenConfigured: report.tokenConfigured,
        outFile: "audit-report.json",
        thresholds: report.thresholds,
        thresholdsMet: report.thresholdsMet.map((t) => t.summary),
        thresholdsNotMet: report.thresholdsNotMet.map((t) => t.summary),
        propose: report.propose,
        skip: report.skip,
        areas: {
          guests: {
            value: report.areas.guests.value,
            threshold: report.areas.guests.threshold,
            verdict: report.areas.guests.verdict,
            action: report.areas.guests.action,
            summary: report.areas.guests.summary,
            sample: report.areas.guests.sample,
          },
          listingNicknames: {
            value: report.areas.listingNicknames.value,
            threshold: report.areas.listingNicknames.threshold,
            verdict: report.areas.listingNicknames.verdict,
            action: report.areas.listingNicknames.action,
            summary: report.areas.listingNicknames.summary,
            sample: report.areas.listingNicknames.sample,
          },
          tasks: {
            value: report.areas.tasks.value,
            threshold: report.areas.tasks.threshold,
            verdict: report.areas.tasks.verdict,
            action: report.areas.tasks.action,
            summary: report.areas.tasks.summary,
            extra: report.areas.tasks.extra,
            sample: report.areas.tasks.sample,
          },
          customFields: {
            value: report.areas.customFields.value,
            threshold: report.areas.customFields.threshold,
            verdict: report.areas.customFields.verdict,
            action: report.areas.customFields.action,
            summary: report.areas.customFields.summary,
            extra: report.areas.customFields.extra,
            sample: report.areas.customFields.sample,
          },
          inbox: report.areas.inbox,
          reservations: report.areas.reservations,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
