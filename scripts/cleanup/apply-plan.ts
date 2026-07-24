#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyMutationPlan, parseMutationPlan } from "../../src/cleanup/apply.js";
import { hasGuestyAuthConfigured } from "../../src/guesty/config.js";

function usage(): never {
  console.error(`Usage:
  npm run cleanup:apply -- [--plan <path>] [--dry-run | --apply]

Defaults:
  --plan mutation-plan.json
  --dry-run (no API writes)

Requires GUESTY_ACCESS_TOKEN or GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in local .env when using --apply.
Never prints tokens; reports tokenConfigured only.`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let planPath = "mutation-plan.json";
  let apply = false;
  let sawDryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--plan") {
      planPath = args[++i];
      if (!planPath) usage();
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      sawDryRun = true;
      apply = false;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }

  if (apply && sawDryRun) {
    console.error("Use either --apply or --dry-run, not both.");
    process.exit(1);
  }

  if (apply && !hasGuestyAuthConfigured()) {
    console.error(
      "Missing Guesty auth. Copy .env.example to .env and set GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET (or GUESTY_ACCESS_TOKEN).",
    );
    process.exit(1);
  }

  const abs = resolve(process.cwd(), planPath);
  const raw = JSON.parse(await readFile(abs, "utf8")) as unknown;
  const plan = parseMutationPlan(raw);

  const report = await applyMutationPlan(plan, { apply });
  console.log(JSON.stringify(report, null, 2));

  if (report.failureCount > 0) process.exit(2);
  if (plan.manual?.length) {
    console.error(
      `\n${plan.manual.length} manual item(s) remain (inbox / channel) — see plan.manual`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
