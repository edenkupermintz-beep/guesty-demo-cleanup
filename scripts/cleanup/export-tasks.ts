/**
 * Export all Guesty tasks via GET /tasks (paginated).
 * Writes gitignored tasks-export.json.
 *
 * Usage: npm run cleanup:export-tasks
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../../src/guesty/config.js";

const FIELDS = [
  "_id",
  "title",
  "status",
  "type",
  "priority",
  "listingId",
  "reservationId",
  "assigneeId",
  "startTime",
  "canStartAfter",
  "mustFinishBefore",
  "createdAt",
  "updatedAt",
  "plannedDuration",
].join(" ");

async function main() {
  const config = await loadConfig();
  const tasks: unknown[] = [];
  let skip = 0;
  const pageSize = 100;

  for (;;) {
    const path = `/tasks?fields=${encodeURIComponent(FIELDS)}&limit=${pageSize}&skip=${skip}`;
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text) as { results?: unknown[]; data?: unknown[] };
    const page = data.results || data.data || [];
    tasks.push(...page);
    if (tasks.length % 1000 === 0 || page.length < pageSize) {
      console.error(`fetched ${tasks.length}`);
    }
    if (page.length < pageSize) break;
    skip += pageSize;
    if (skip > 100_000) throw new Error(`safety stop at skip=${skip}`);
  }

  const fetchedAt = new Date().toISOString();
  writeFileSync(
    "tasks-export.json",
    JSON.stringify({ total: tasks.length, fetchedAt, tasks }, null, 2),
  );
  console.log(
    JSON.stringify(
      { total: tasks.length, fetchedAt, out: "tasks-export.json", tokenConfigured: true },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
