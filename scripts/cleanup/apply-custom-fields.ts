/**
 * Apply custom-fields-plan.json: delete extras, fix enum options, create missing.
 * Resumable via custom-fields-results.json.
 *
 * Usage:
 *   npm run cleanup:apply-custom-fields                 # dry-run summary
 *   npm run cleanup:apply-custom-fields -- --apply      # mutate
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CustomFieldMutation } from "../../src/cleanup/score-custom-fields.js";
import { loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

type Plan = {
  generatedAt?: string;
  accountId: string;
  totals?: Record<string, number>;
  mutations: CustomFieldMutation[];
};

type ResultRow = {
  op: string;
  resultKey: string;
  key?: string;
  fieldId?: string;
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
      argv.find((a, i) => argv[i - 1] === "--plan") ?? "custom-fields-plan.json",
    ),
    resultsPath: resolve(process.cwd(), "custom-fields-results.json"),
    delayMs: numFlag("--delay-ms", 200),
  };
}

function mutationKey(m: CustomFieldMutation): string {
  if (m.op === "delete_custom_field") return `delete:${m.fieldId}`;
  if (m.op === "update_custom_field_options") return `fix:${m.fieldId}`;
  return `create:${m.object}::${m.key}`;
}

async function withRetry(fn: () => Promise<unknown>, maxAttempts = 6): Promise<void> {
  let attempt = 0;
  let backoff = 1000;
  for (;;) {
    attempt += 1;
    try {
      await fn();
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.planPath)) {
    throw new Error(`Plan not found: ${args.planPath}`);
  }

  const plan = JSON.parse(readFileSync(args.planPath, "utf8")) as Plan;
  if (!plan.accountId) {
    throw new Error("Plan missing accountId");
  }
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];

  console.log(
    JSON.stringify(
      {
        tokenConfigured: true,
        plan: args.planPath,
        generatedAt: plan.generatedAt,
        accountId: plan.accountId,
        totals: plan.totals,
        toProcess: mutations.length,
        apply: args.apply,
        delayMs: args.delayMs,
      },
      null,
      2,
    ),
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to mutate custom fields.");
    return;
  }

  const results: ResultRow[] = [];
  const doneKeys = new Set<string>();
  if (existsSync(args.resultsPath)) {
    const prev = JSON.parse(readFileSync(args.resultsPath, "utf8")) as {
      results?: ResultRow[];
    };
    for (const row of prev.results ?? []) {
      results.push(row);
      if (row.ok && row.resultKey) doneKeys.add(row.resultKey);
    }
  }

  const config = await loadConfig();
  const client = new GuestyWriteClient(config);
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const m of mutations) {
    const rk = mutationKey(m);
    if (doneKeys.has(rk)) {
      skipped += 1;
      continue;
    }

    const at = new Date().toISOString();
    try {
      if (m.op === "delete_custom_field") {
        try {
          await withRetry(() =>
            client.deleteCustomField(plan.accountId, m.fieldId),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/\b404\b/.test(msg)) throw err;
        }
        results.push({
          op: m.op,
          resultKey: rk,
          fieldId: m.fieldId,
          key: m.key,
          ok: true,
          at,
        });
      } else if (m.op === "update_custom_field_options") {
        await withRetry(() =>
          client.updateCustomFieldOptions(plan.accountId, {
            fieldId: m.fieldId,
            key: m.key,
            object: m.object,
            isPublic: m.isPublic,
            options: m.options,
          }),
        );
        results.push({
          op: m.op,
          resultKey: rk,
          fieldId: m.fieldId,
          key: m.key,
          ok: true,
          at,
        });
      } else if (m.op === "create_custom_field") {
        await withRetry(() =>
          client.createCustomFields(plan.accountId, [
            {
              key: m.key,
              object: m.object,
              type: m.type,
              isPublic: m.isPublic,
              options: m.options,
            },
          ]),
        );
        results.push({
          op: m.op,
          resultKey: rk,
          key: `${m.object}::${m.key}`,
          ok: true,
          at,
        });
      } else {
        throw new Error(`Unknown op: ${(m as CustomFieldMutation).op}`);
      }
      doneKeys.add(rk);
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        op: m.op,
        resultKey: rk,
        fieldId: "fieldId" in m ? m.fieldId : undefined,
        key:
          m.op === "create_custom_field"
            ? `${m.object}::${m.key}`
            : "key" in m
              ? m.key
              : undefined,
        ok: false,
        error: msg.slice(0, 500),
        at,
      });
      fail += 1;
    }

    writeFileSync(
      args.resultsPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          accountId: plan.accountId,
          results,
        },
        null,
        2,
      ),
    );

    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log(
    JSON.stringify(
      {
        tokenConfigured: true,
        resultsFile: "custom-fields-results.json",
        ok,
        fail,
        skipped,
        totalResults: results.length,
      },
      null,
      2,
    ),
  );

  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
