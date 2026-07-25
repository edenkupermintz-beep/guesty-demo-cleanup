/**
 * Build tasks-delete-plan.json from tasks-export.json.
 * Default: keep max 50 per normalized title (active statuses), DELETE the rest.
 *
 * Usage:
 *   npm run cleanup:plan-delete-tasks
 *   npm run cleanup:plan-delete-tasks -- --keep-per-title 50
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreTasks, type TaskScoreRow } from "../../src/cleanup/score-tasks.js";

const KEEPABLE = new Set(["pending", "confirmed", "in progress"]);

function normTitle(t: string | null | undefined) {
  return (t || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() || "(untitled)";
}

function listingKey(t: TaskScoreRow) {
  return String(t.listingId || t.listing?._id || "(no listing)");
}

function taskId(t: TaskScoreRow) {
  return String(t._id || t.id);
}

function createdMs(t: TaskScoreRow) {
  const d = Date.parse(t.createdAt || t.updatedAt || "0");
  return Number.isFinite(d) ? d : 0;
}

function parseArgs(argv: string[]) {
  const i = argv.indexOf("--keep-per-title");
  let keepPerTitle = 50;
  try {
    const zs = JSON.parse(
      readFileSync(
        resolve(process.cwd(), ".cursor/skills/guesty-demo-cleanup/zero-state.json"),
        "utf8",
      ),
    ) as { tasks?: { keepPerTitle?: number } };
    if (zs.tasks?.keepPerTitle && Number.isFinite(zs.tasks.keepPerTitle)) {
      keepPerTitle = zs.tasks.keepPerTitle;
    }
  } catch {
    /* default 50 */
  }
  if (i >= 0) keepPerTitle = Number(argv[i + 1]);
  return {
    keepPerTitle,
    exportPath: resolve(process.cwd(), "tasks-export.json"),
    outPath: resolve(process.cwd(), "tasks-delete-plan.json"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.exportPath)) {
    throw new Error(`Missing ${args.exportPath}. Run: npm run cleanup:export-tasks`);
  }
  if (!Number.isFinite(args.keepPerTitle) || args.keepPerTitle < 1) {
    throw new Error("--keep-per-title must be a positive number");
  }

  const raw = JSON.parse(readFileSync(args.exportPath, "utf8")) as {
    fetchedAt?: string;
    tasks: TaskScoreRow[];
  };

  // Full mutation list still needed for apply — rebuild keep/delete sets here.
  type Row = {
    id: string;
    title: string;
    status: string;
    type: string;
    listingId: string;
    reservationId: string | null;
    score: number;
  };

  const byTitle = new Map<string, Row[]>();
  let skipped = 0;

  for (const t of raw.tasks) {
    const status = String(t.status || "unknown").toLowerCase();
    if (!KEEPABLE.has(status)) {
      skipped += 1;
      continue;
    }
    const title = normTitle(t.title);
    const row: Row = {
      id: taskId(t),
      title,
      status,
      type: String(t.type || "unknown"),
      listingId: listingKey(t),
      reservationId: t.reservationId ? String(t.reservationId) : null,
      score:
        (t.reservationId ? 1_000_000 : 0) +
        (listingKey(t) !== "(no listing)" ? 100_000 : 0) +
        createdMs(t),
    };
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title)!.push(row);
  }

  const keep: Row[] = [];
  const del: Row[] = [];
  const titleStats: {
    title: string;
    candidates: number;
    keep: number;
    delete: number;
  }[] = [];

  for (const [title, rows] of [...byTitle.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const kept: Row[] = [];
    const usedListings = new Set<string>();

    for (const r of sorted) {
      if (kept.length >= args.keepPerTitle) break;
      if (usedListings.has(r.listingId) && kept.length > 0 && usedListings.size < args.keepPerTitle) {
        continue;
      }
      kept.push(r);
      usedListings.add(r.listingId);
    }
    if (kept.length < args.keepPerTitle) {
      for (const r of sorted) {
        if (kept.length >= args.keepPerTitle) break;
        if (kept.some((k) => k.id === r.id)) continue;
        kept.push(r);
      }
    }

    const keepIds = new Set(kept.map((k) => k.id));
    const toDelete = rows.filter((r) => !keepIds.has(r.id));
    keep.push(...kept);
    del.push(...toDelete);
    titleStats.push({
      title,
      candidates: rows.length,
      keep: kept.length,
      delete: toDelete.length,
    });
  }

  const scored = scoreTasks(raw.tasks, { keepPerTitle: args.keepPerTitle });
  if (scored.deleteCount !== del.length || scored.keep !== keep.length) {
    console.error(
      `warn: scoreTasks totals (${scored.keep}/${scored.deleteCount}) != plan (${keep.length}/${del.length})`,
    );
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    sourceFetchedAt: raw.fetchedAt,
    policy: {
      action: "delete",
      keepPerTitle: args.keepPerTitle,
      keepableStatuses: [...KEEPABLE],
      keepPreference:
        "reservation-linked, then has listing, then newest; prefer distinct listings",
      notes: [
        "Hard DELETE via DELETE /tasks-open-api/{id}. Prefer delete over cancel (cancel leaves clutter).",
        "Completed/canceled/other statuses left out of this plan (not in keepable set).",
        "Does not stop recurring series or auto-tasks — report UI work separately.",
        "Dry-run only until npm run cleanup:delete-tasks -- --apply.",
      ],
    },
    totals: {
      exported: raw.tasks.length,
      skippedNonKeepable: skipped,
      keepableCandidates: keep.length + del.length,
      keep: keep.length,
      delete: del.length,
      uniqueTitlesTouched: byTitle.size,
      titlesWithDeletes: titleStats.filter((t) => t.delete > 0).length,
      titlesFullyKept: titleStats.filter((t) => t.delete === 0).length,
    },
    topDeleteTitles: titleStats.filter((t) => t.delete > 0).slice(0, 25),
    keepSample: keep.slice(0, 40).map(({ id, title, status, listingId, reservationId }) => ({
      id,
      title,
      status,
      listingId,
      reservationId,
    })),
    mutations: del.map((r) => ({
      op: "delete_task" as const,
      taskId: r.id,
      title: r.title,
      status: r.status,
      listingId: r.listingId,
      reservationId: r.reservationId,
    })),
  };

  writeFileSync(args.outPath, JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify(
      {
        out: args.outPath,
        keepPerTitle: args.keepPerTitle,
        totals: plan.totals,
        top5: plan.topDeleteTitles.slice(0, 5),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
