/**
 * Retry failed guest renames from guest-rename-results.json + guest-rename-plan.json.
 * - 429: backoff + retry
 * - 400 invalid phone: clear phone fields then rename (names still primary; phone was already invalid)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../../src/guesty/config.js";

type PlanItem = {
  id: string;
  after: { firstName: string; lastName: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function putGuest(
  baseUrl: string,
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${baseUrl}/guests/${id}`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync("guest-rename-plan.json", "utf8")) as {
    plan: PlanItem[];
  };
  const results = JSON.parse(readFileSync("guest-rename-results.json", "utf8")) as {
    failures: Array<{ id: string; error: string }>;
  };

  const byId = new Map(plan.plan.map((p) => [p.id, p]));
  const failedIds = results.failures.map((f) => f.id);
  const config = await loadConfig();

  let ok = 0;
  let fail = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < failedIds.length; i++) {
    const id = failedIds[i];
    const item = byId.get(id);
    if (!item) {
      fail++;
      failures.push({ id, error: "missing from plan" });
      continue;
    }

    const nameBody = {
      firstName: item.after.firstName,
      lastName: item.after.lastName,
    };

    let succeeded = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await putGuest(config.baseUrl, config.accessToken, id, nameBody);
        succeeded = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("429")) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        if (msg.includes("Invalid phone number")) {
          try {
            await putGuest(config.baseUrl, config.accessToken, id, {
              ...nameBody,
              phone: "",
              phones: [],
            });
            succeeded = true;
            break;
          } catch (err2) {
            failures.push({
              id,
              error: err2 instanceof Error ? err2.message : String(err2),
            });
            break;
          }
        }
        failures.push({ id, error: msg });
        break;
      }
    }

    if (succeeded) ok++;
    else if (!failures.find((f) => f.id === id)) {
      fail++;
      failures.push({ id, error: "exhausted retries" });
    } else {
      fail++;
    }

    if ((i + 1) % 20 === 0 || i === failedIds.length - 1) {
      console.error(`retry progress ${i + 1}/${failedIds.length} ok=${ok} fail=${fail}`);
    }
    await sleep(400);
  }

  writeFileSync(
    "guest-rename-retry-results.json",
    JSON.stringify({ ok, fail, failures, completedAt: new Date().toISOString() }, null, 2),
  );
  console.log(JSON.stringify({ ok, fail, failureCount: failures.length }, null, 2));
  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
