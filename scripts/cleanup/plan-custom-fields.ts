/**
 * Build custom-fields-plan.json from live account definitions vs zero-state catalog.
 *
 * Usage: npm run cleanup:plan-custom-fields
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCustomFieldsPlan } from "../../src/cleanup/score-custom-fields.js";
import {
  loadZeroState,
  resolveCustomFieldsCatalog,
} from "../../src/cleanup/zero-state.js";
import { hasGuestyAuthConfigured, loadConfig } from "../../src/guesty/config.js";
import { GuestyWriteClient } from "../../src/guesty/write-client.js";

async function main(): Promise<void> {
  if (!hasGuestyAuthConfigured()) {
    throw new Error(
      "Missing Guesty auth. Set GUESTY_ACCESS_TOKEN or GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env.",
    );
  }

  const zs = loadZeroState();
  const catalog = resolveCustomFieldsCatalog(zs);
  if (catalog.length === 0) {
    throw new Error(
      "zero-state.json customFields.catalog is empty — refuse to plan (would delete all fields).",
    );
  }

  const config = await loadConfig();
  const client = new GuestyWriteClient(config);
  const { id: accountId } = await client.getAccountMe();
  const live = await client.listCustomFields(accountId);
  const { score, mutations } = buildCustomFieldsPlan(live, catalog);

  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    accountId,
    tokenConfigured: true,
    policy: {
      catalogCount: catalog.length,
      note: zs.customFields?.note,
    },
    totals: {
      live: score.liveCount,
      catalog: score.catalogCount,
      keep: score.keep,
      dirtyCount: score.dirtyCount,
      toDelete: score.toDelete.length,
      toFixOptions: score.toFixOptions.length,
      toCreate: score.toCreate.length,
    },
    catalog,
    mutations,
  };

  const outPath = resolve(process.cwd(), "custom-fields-plan.json");
  writeFileSync(outPath, JSON.stringify(plan, null, 2));

  console.log(
    JSON.stringify(
      {
        tokenConfigured: true,
        outFile: "custom-fields-plan.json",
        accountId,
        totals: plan.totals,
        sample: mutations.slice(0, 12),
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
