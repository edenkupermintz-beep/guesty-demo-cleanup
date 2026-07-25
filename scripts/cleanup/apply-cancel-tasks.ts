/**
 * Apply tasks-cancel-plan.json: PUT status=canceled for each mutation.
 * Resumable via tasks-cancel-results.json (skips already-ok taskIds).
 *
 * Usage:
 *   npm run cleanup:cancel-tasks                 # dry-run summary
 *   npm run cleanup:cancel-tasks -- --apply      # mutate
 *   npm run cleanup:cancel-tasks -- --apply --concurrency 8 --delay-ms 0
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

type Mutation = {
  op: string;
  taskId: string;
  title?: string;
  status?: string;
  listingId?: string;
  reservationId?: string | null;
};

type Plan = {
  generatedAt?: string;
  policy?: { keepPerTitle?: number; action?: string };
  totals?: Record<string, number>;
  mutations: Mutation[];
};

type ResultRow = {
  taskId: string;
  title?: string;
  ok: boolean;
  error?: string;
  at: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]) {
  const numFlag = (name: string, fallback: number) => {
    const i = argv.indexOf(name);
    return i >= 0 ? Number(argv[i + 1]) : fallback;
  };
  return {
    apply: argv.includes("--apply"),
    planPath: resolve(
      process.cwd(),
      argv.find((a, i) => argv[i - 1] === "--plan") ?? "tasks-cancel-plan.json",
    ),
    resultsPath: resolve(process.cwd(), "tasks-cancel-results.json"),
    delayMs: numFlag("--delay-ms", 0),
    concurrency: Math.max(1, numFlag("--concurrency", 8)),
    limit: (() => {
      const i = argv.indexOf("--limit");
      return i >= 0 ? Number(argv[i + 1]) : undefined;
    })(),
  };
}

async function cancelWithRetry(
  client: GuestyWriteClient,
  taskId: string,
  maxAttempts = 8,
): Promise<void> {
  let attempt = 0;
  let backoff = 1000;
  for (;;) {
    attempt += 1;
    try {
      await client.cancelTask(taskId);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /\b(429|502|503|504)\b/.test(msg);
      if (!retryable || attempt >= maxAttempts) throw err;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.planPath)) {
    throw new Error(`Plan not found: ${args.planPath}`);
  }

  const plan = JSON.parse(readFileSync(args.planPath, "utf8")) as Plan;
  let mutations = plan.mutations.filter((m) => m.op === "cancel_task" && m.taskId);
  if (args.limit != null && Number.isFinite(args.limit)) {
    mutations = mutations.slice(0, args.limit);
  }

  console.log(
    JSON.stringify(
      {
        plan: args.planPath,
        generatedAt: plan.generatedAt,
        keepPerTitle: plan.policy?.keepPerTitle,
        totals: plan.totals,
        toProcess: mutations.length,
        apply: args.apply,
        delayMs: args.delayMs,
        concurrency: args.concurrency,
      },
      null,
      2,
    ),
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to cancel.");
    return;
  }

  const prior: ResultRow[] = existsSync(args.resultsPath)
    ? (JSON.parse(readFileSync(args.resultsPath, "utf8")) as { results?: ResultRow[] }).results ??
      []
    : [];
  const doneOk = new Set(prior.filter((r) => r.ok).map((r) => r.taskId));
  const pending = mutations.filter((m) => !doneOk.has(m.taskId));
  console.error(`resume: ${doneOk.size} already ok, ${pending.length} remaining`);

  const config = await loadConfig();
  const client = new GuestyWriteClient(config);
  const results: ResultRow[] = [...prior.filter((r) => r.ok)];
  let ok = 0;
  let fail = 0;
  let completed = 0;
  let writing = Promise.resolve();

  const persist = () => {
    writing = writing.then(() => {
      writeFileSync(
        args.resultsPath,
        JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            ok: results.filter((r) => r.ok).length,
            fail: results.filter((r) => !r.ok).length,
            results,
          },
          null,
          2,
        ),
      );
    });
    return writing;
  };

  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= pending.length) return;
      const m = pending[i]!;
      try {
        await cancelWithRetry(client, m.taskId);
        results.push({ taskId: m.taskId, title: m.title, ok: true, at: new Date().toISOString() });
        ok += 1;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({
          taskId: m.taskId,
          title: m.title,
          ok: false,
          error,
          at: new Date().toISOString(),
        });
        fail += 1;
        console.error(`FAIL ${m.taskId} ${m.title}: ${error.slice(0, 200)}`);
      }

      completed += 1;
      if (completed % 100 === 0 || completed === pending.length) {
        await persist();
        console.error(
          `progress ${completed}/${pending.length} (session ok=${ok} fail=${fail}, total ok=${results.filter((r) => r.ok).length})`,
        );
      }

      if (args.delayMs > 0) await sleep(args.delayMs);
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  await persist();

  console.log(
    JSON.stringify(
      {
        done: true,
        ok: results.filter((r) => r.ok).length,
        fail: results.filter((r) => !r.ok).length,
        resultsPath: args.resultsPath,
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
