# guesty-folio-delta

Cursor agent + CLI tooling for Guesty:

1. **Folio delta (reconcile)** — report differences between a reservation’s guest folio (`money.totalPaid`) and its **Advanced Deposit** ledger. Report only; no writes.
2. **Demo cleanup** — on-request skill that audits a sales demo account via Guesty MCP and applies Open API cleanup scripts after you confirm. See [`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/).

## Setup

```bash
cp .env.example .env
# put DEMO GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env
npm install
npm run token -- --write   # curl OAuth → writes GUESTY_ACCESS_TOKEN
```

`.env` is gitignored. Never commit tokens.

## Folio reconcile

```bash
npm run reconcile -- --confirmation ABC1234
npm run reconcile -- --confirmation ABC1234 --json
npm test
```

Primary formula:

```
delta = totalPaid − AD payment credits (trigger=PAYMENT)
```

Positive delta → guest collected more than AD payment credits  
Negative delta → AD shows more payment credit than guest `totalPaid`

## Demo cleanup

Recurring sales-demo hygiene (token refresh → guest export → bulk rename → optional
reservation cancel). Skill: [`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/).

```bash
npm run token -- --write
npm run cleanup:export-guests
npm run cleanup:rename-guests                 # dry-run; confirm before apply
npm run cleanup:rename-guests -- --apply      # names-only PUT
npm run cleanup:rename-listing-nicknames      # dry-run nicknames (titles untouched)
npm run cleanup:rename-listing-nicknames -- --apply

# Optional reservation / sanitize plan (confirm first):
npm run cleanup:apply -- --plan mutation-plan.json
npm run cleanup:apply -- --plan mutation-plan.json --apply
```

Cleanup never changes listing **titles**, rate plans, or account settings by default.
Inbox wipe is not available via API (reported as manual). Guest hygiene is **names only**.
Listing hygiene is **nickname only** (`GueStay - {City}[- {UnitType}]`; unique per Guesty).

## Project layout

- `src/guesty/` — API client + auth config (+ write client for cleanup)
- `src/reconcile/` — deterministic folio compare
- `src/cleanup/` — mutation plan apply (dry-run / apply)
- `src/report/` — human-readable reconcile report
- `src/cli.ts` — reconcile entrypoint
- `scripts/cleanup/` — cleanup CLI
- `AGENTS.md` — reconcile agent instructions
- `.cursor/skills/guesty-demo-cleanup/` — demo cleanup skill + zero-state policy
