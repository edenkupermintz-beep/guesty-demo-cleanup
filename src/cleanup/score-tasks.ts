export type TaskScoreRow = {
  _id?: string;
  id?: string;
  title?: string;
  status?: string;
  type?: string;
  listingId?: string;
  listing?: { _id?: string };
  reservationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type TaskDeleteTitleStat = {
  title: string;
  candidates: number;
  keep: number;
  delete: number;
};

export type TaskScoreResult = {
  metric: "deleteCount";
  exported: number;
  skippedNonKeepable: number;
  keepableCandidates: number;
  keep: number;
  deleteCount: number;
  keepPerTitle: number;
  uniqueTitles: number;
  topDeleteTitles: TaskDeleteTitleStat[];
};

export type ScoreTasksOptions = {
  keepPerTitle?: number;
  keepableStatuses?: string[];
};

const DEFAULT_KEEPABLE = ["pending", "confirmed", "in progress"];

function normTitle(t: string | null | undefined) {
  return (
    (t || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() ||
    "(untitled)"
  );
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

/**
 * Score excess active tasks using the same keep-N-per-title policy as
 * cleanup:plan-delete-tasks. Does not build the full delete mutation list.
 */
export function scoreTasks(
  tasks: TaskScoreRow[],
  options: ScoreTasksOptions = {},
): TaskScoreResult {
  const keepPerTitle = options.keepPerTitle ?? 50;
  const keepable = new Set(
    (options.keepableStatuses ?? DEFAULT_KEEPABLE).map((s) => s.toLowerCase()),
  );

  type Row = {
    id: string;
    title: string;
    listingId: string;
    reservationId: string | null;
    score: number;
  };

  const byTitle = new Map<string, Row[]>();
  let skipped = 0;

  for (const t of tasks) {
    const status = String(t.status || "unknown").toLowerCase();
    if (!keepable.has(status)) {
      skipped += 1;
      continue;
    }
    const title = normTitle(t.title);
    const row: Row = {
      id: taskId(t),
      title,
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

  let keepTotal = 0;
  let deleteTotal = 0;
  const titleStats: TaskDeleteTitleStat[] = [];

  for (const [title, rows] of [...byTitle.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const kept: Row[] = [];
    const usedListings = new Set<string>();

    for (const r of sorted) {
      if (kept.length >= keepPerTitle) break;
      if (
        usedListings.has(r.listingId) &&
        kept.length > 0 &&
        usedListings.size < keepPerTitle
      ) {
        continue;
      }
      kept.push(r);
      usedListings.add(r.listingId);
    }
    if (kept.length < keepPerTitle) {
      for (const r of sorted) {
        if (kept.length >= keepPerTitle) break;
        if (kept.some((k) => k.id === r.id)) continue;
        kept.push(r);
      }
    }

    const keepIds = new Set(kept.map((k) => k.id));
    const toDelete = rows.length - keepIds.size;
    keepTotal += kept.length;
    deleteTotal += toDelete;
    titleStats.push({
      title,
      candidates: rows.length,
      keep: kept.length,
      delete: toDelete,
    });
  }

  return {
    metric: "deleteCount",
    exported: tasks.length,
    skippedNonKeepable: skipped,
    keepableCandidates: keepTotal + deleteTotal,
    keep: keepTotal,
    deleteCount: deleteTotal,
    keepPerTitle,
    uniqueTitles: byTitle.size,
    topDeleteTitles: titleStats.filter((t) => t.delete > 0).slice(0, 8),
  };
}
