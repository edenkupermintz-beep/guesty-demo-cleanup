export type GuestScoreRow = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
};

export type GuestDirtyReason =
  | "forbidden"
  | "group"
  | "junk"
  | "duplicate"
  | "bad_pattern";

export type GuestDirtySample = {
  id: string;
  before: string;
  reason: GuestDirtyReason;
};

export type GuestScoreResult = {
  metric: "renameCount";
  totalGuests: number;
  renameCount: number;
  sample: GuestDirtySample[];
};

export type ScoreGuestsOptions = {
  allowlistGuestIds?: Iterable<string>;
  duplicateFullNameThreshold?: number;
  forbiddenNameSubstrings?: string[];
};

const DEFAULT_FORBIDDEN = [
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

function isGroupName(full: string): boolean {
  return /\bgroup\b/i.test(full) && /\bguest\s+\d+/i.test(full);
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

function containsForbidden(full: string, forbidden: string[]): boolean {
  const n = norm(full);
  return forbidden.some((s) => n.includes(s));
}

function classifyGuest(
  g: GuestScoreRow,
  forbidden: string[],
): GuestDirtyReason | null {
  const full = norm(g.fullName);
  const first = norm(g.firstName);
  const last = norm(g.lastName);
  if (
    containsForbidden(full, forbidden) ||
    containsForbidden(first, forbidden) ||
    containsForbidden(last, forbidden)
  ) {
    return "forbidden";
  }
  if (isGroupName(g.fullName ?? "")) return "group";
  if (looksJunk(full, first, last)) return "junk";
  if (
    full === "david gomel" ||
    full === "john doe" ||
    full === "jane doe" ||
    full === "john smith"
  ) {
    return "bad_pattern";
  }
  return null;
}

/** Count guests that would be renamed by cleanup:rename-guests (names-only). */
export function scoreGuests(
  guests: GuestScoreRow[],
  options: ScoreGuestsOptions = {},
): GuestScoreResult {
  const allowlist = new Set(options.allowlistGuestIds ?? []);
  const dupeThreshold = options.duplicateFullNameThreshold ?? 5;
  const forbidden = options.forbiddenNameSubstrings ?? DEFAULT_FORBIDDEN;

  const counts = new Map<string, number>();
  for (const g of guests) {
    const n = norm(g.fullName);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  const dirty: GuestDirtySample[] = [];
  for (const g of guests) {
    if (allowlist.has(g.id)) continue;
    const reason = classifyGuest(g, forbidden);
    if (reason) {
      dirty.push({
        id: g.id,
        before: g.fullName || `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim(),
        reason,
      });
      continue;
    }
    const n = norm(g.fullName);
    if ((counts.get(n) ?? 0) >= dupeThreshold) {
      dirty.push({
        id: g.id,
        before: g.fullName || `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim(),
        reason: "duplicate",
      });
    }
  }

  return {
    metric: "renameCount",
    totalGuests: guests.length,
    renameCount: dirty.length,
    sample: dirty.slice(0, 8),
  };
}
