/**
 * Export all guests to guests-export.json (gitignored) for audit / bulk rename.
 *
 * Usage:
 *   npm run cleanup:export-guests
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../../src/guesty/config.js";

type GuestApi = {
  _id?: string;
  id?: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
};

type GuestRow = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

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
    throw new Error(
      `Guesty ${res.status} ${res.statusText} for ${pathAndQuery}: ${body.slice(0, 400)}`,
    );
  }
  return (await res.json()) as T;
}

function mapGuest(g: GuestApi): GuestRow | null {
  const id = g._id ?? g.id;
  if (!id) return null;
  return {
    id,
    fullName: g.fullName ?? null,
    firstName: g.firstName ?? null,
    lastName: g.lastName ?? null,
    email: g.email ?? null,
    phone: g.phone ?? null,
  };
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const fields = encodeURIComponent("_id fullName firstName lastName email phone");
  const pageSize = 100;
  const guests: GuestRow[] = [];
  let skip = 0;

  for (;;) {
    const data = await guestyGet<{
      results?: GuestApi[];
      data?: GuestApi[];
      count?: number;
    }>(
      config.baseUrl,
      config.accessToken,
      `/guests?fields=${fields}&limit=${pageSize}&skip=${skip}`,
    );
    const page = data.results ?? data.data ?? [];
    for (const row of page) {
      const mapped = mapGuest(row);
      if (mapped) guests.push(mapped);
    }
    console.error(`fetched ${guests.length}${data.count != null ? ` / ${data.count}` : ""}`);
    if (page.length < pageSize) break;
    skip += pageSize;
  }

  const out = {
    total: guests.length,
    fetchedAt: new Date().toISOString(),
    guests,
  };
  writeFileSync("guests-export.json", JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        total: guests.length,
        outFile: "guests-export.json",
        tokenConfigured: true,
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
