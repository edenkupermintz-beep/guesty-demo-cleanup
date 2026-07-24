/**
 * Intake smoke test:
 * 1) GET /listings — find title in the returned array
 * 2) GET /reservations-v3/search?filter[listingId]=… — next upcoming stay
 *
 * Docs:
 * - https://open-api-docs.guesty.com/reference/get_listings
 * - https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_searchreservations
 */
import { loadConfig } from "../src/guesty/config.js";

const TARGET_TITLE = "C1 - GueStay London Lofts";

type Listing = {
  _id: string;
  title?: string;
  nickname?: string;
};

type Reservation = {
  _id: string;
  confirmationCode?: string;
  status?: string;
  checkInDateLocalized?: string;
  checkOutDateLocalized?: string;
  guestId?: string;
  source?: string;
};

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function guestyGet<T>(
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
    throw new Error(`Guesty ${res.status} ${res.statusText} for ${pathAndQuery}: ${body.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

async function findListingByTitle(
  baseUrl: string,
  token: string,
  title: string,
): Promise<Listing> {
  const fields = encodeURIComponent("_id title nickname");
  const pageSize = 100;
  const want = normalizeTitle(title);
  const scanned: string[] = [];
  let skip = 0;

  for (;;) {
    // Omit active/listed so we are not limited to the API defaults when possible.
    const data = await guestyGet<{ results?: Listing[]; data?: Listing[] }>(
      baseUrl,
      token,
      `/listings?fields=${fields}&limit=${pageSize}&skip=${skip}&sort=title`,
    );
    const page = data.results ?? data.data ?? [];
    for (const listing of page) {
      const labels = [listing.title, listing.nickname].filter(Boolean) as string[];
      for (const label of labels) scanned.push(label);
      if (labels.some((label) => normalizeTitle(label) === want)) {
        return listing;
      }
    }
    if (page.length < pageSize) break;
    skip += pageSize;
  }

  const near = scanned
    .filter((t) => /c1|guestay|london loft/i.test(t))
    .slice(0, 20);
  throw new Error(
    `No listing found with title/nickname === ${JSON.stringify(title)}` +
      (near.length ? `; near matches: ${JSON.stringify(near)}` : `; scanned ${scanned.length} titles`),
  );
}

async function nextReservationForListing(
  baseUrl: string,
  token: string,
  listingId: string,
  checkInOnOrAfter: string,
): Promise<Reservation | undefined> {
  const params = new URLSearchParams({
    "filter[listingId]": listingId,
    "filter[checkIn][gte]": checkInOnOrAfter,
    "filter[status]": "confirmed,reserved,checked_in",
    sort: "checkIn",
    limit: "5",
    skip: "0",
  });

  const data = await guestyGet<{ results?: Reservation[]; data?: Reservation[] }>(
    baseUrl,
    token,
    `/reservations-v3/search?${params.toString()}`,
  );
  const results = data.results ?? data.data ?? [];
  return results[0];
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const today = new Date().toISOString().slice(0, 10);

  const listing = await findListingByTitle(config.baseUrl, config.accessToken, TARGET_TITLE);
  const next = await nextReservationForListing(
    config.baseUrl,
    config.accessToken,
    listing._id,
    today,
  );

  console.log(
    JSON.stringify(
      {
        listing: {
          id: listing._id,
          title: listing.title,
          nickname: listing.nickname,
        },
        asOf: today,
        nextReservation: next
          ? {
              id: next._id,
              confirmationCode: next.confirmationCode,
              status: next.status,
              checkIn: next.checkInDateLocalized,
              checkOut: next.checkOutDateLocalized,
              guestId: next.guestId,
              source: next.source,
            }
          : null,
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
