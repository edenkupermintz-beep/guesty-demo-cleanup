export type ListingScoreRow = {
  _id: string;
  title?: string;
  nickname?: string;
  propertyType?: string;
  roomType?: string;
  address?: { city?: string; full?: string };
};

export type NicknamePlanRow = {
  id: string;
  title: string | null;
  city: string;
  before: string | null;
  after: string;
  unitType: string | null;
  sharedMultiUnit: boolean;
};

export type NicknameScoreResult = {
  metric: "renameCount";
  totalListings: number;
  renameCount: number;
  missingCity: number;
  sample: Array<{
    id: string;
    before: string | null;
    after: string;
    city: string;
  }>;
  missingCitySample: Array<{ id: string; title?: string; nickname?: string }>;
};

export type ScoreNicknamesOptions = {
  sharedNicknameCities?: string[];
  unitTypes?: string[];
  maxPreferredPerBaseNickname?: number;
};

const DEFAULT_UNIT_TYPES = [
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

function inferUnitType(l: ListingScoreRow): string | null {
  const blob =
    `${l.title || ""} ${l.nickname || ""} ${l.propertyType || ""} ${l.roomType || ""}`.toLowerCase();
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

export function buildNicknamePlan(
  listings: ListingScoreRow[],
  options: ScoreNicknamesOptions = {},
): {
  plan: NicknamePlanRow[];
  missingCity: Array<{ id: string; title?: string; nickname?: string }>;
} {
  const sharedCities = new Set(
    (options.sharedNicknameCities ?? ["Atlanta"]).map((c) => c.toLowerCase()),
  );
  const unitTypes = options.unitTypes?.length
    ? options.unitTypes
    : [...DEFAULT_UNIT_TYPES];
  const maxPerBase = options.maxPreferredPerBaseNickname ?? 3;

  const enriched = listings.map((l) => ({
    l,
    city:
      (l.address?.city || "").trim() ||
      guessCityFromFull(l.address?.full) ||
      "",
  }));

  const byCity = new Map<string, typeof enriched>();
  for (const row of enriched) {
    const key = row.city ? titleCaseCity(row.city) : "";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(row);
  }

  const plan: NicknamePlanRow[] = [];
  const missingCity: Array<{ id: string; title?: string; nickname?: string }> =
    [];
  const reserved = new Set<string>();

  for (const [cityKey, rows] of byCity) {
    if (!cityKey) {
      for (const { l } of rows) {
        missingCity.push({ id: l._id, title: l.title, nickname: l.nickname });
      }
      continue;
    }

    const shareSame =
      sharedCities.has(cityKey.toLowerCase()) || rows.length === 1;

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
          sharedMultiUnit: sharedCities.has(cityKey.toLowerCase()),
        });
      }
      continue;
    }

    const typeCounts = new Map<string, number>();
    let typeIdx = 0;
    for (const row of rows) {
      let unitType = inferUnitType(row.l);
      if (unitType && (typeCounts.get(unitType) || 0) >= maxPerBase) {
        unitType = null;
      }
      if (!unitType) {
        for (let n = 0; n < unitTypes.length * 3; n++) {
          const cand = unitTypes[typeIdx % unitTypes.length];
          typeIdx++;
          if ((typeCounts.get(cand) || 0) < maxPerBase) {
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

export function scoreListingNicknames(
  listings: ListingScoreRow[],
  options: ScoreNicknamesOptions = {},
): NicknameScoreResult {
  const { plan, missingCity } = buildNicknamePlan(listings, options);
  return {
    metric: "renameCount",
    totalListings: listings.length,
    renameCount: plan.length,
    missingCity: missingCity.length,
    sample: plan.slice(0, 8).map((p) => ({
      id: p.id,
      before: p.before,
      after: p.after,
      city: p.city,
    })),
    missingCitySample: missingCity.slice(0, 10),
  };
}
