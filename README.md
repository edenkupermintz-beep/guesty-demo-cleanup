# guesty-demo-cleanup

## NOTE: THIS SKILL IS PUBLISHED FOR INTERNAL USE ONLY. CONTACT SALES ENGINEERING TO RUN THIS SKILL ON THE SALES DEMO ACCOUNT. EVERY OTHER GUESTY ACCOUNT IS FAIR GAME - RUN AT YOUR OWN RISK.


Cursor skill + Open API scripts for **sales-demo Guesty account hygiene**.

Preserve rate plans and core setup. Clean operational clutter: guest names, listing
**nicknames**, and junk reservations. Inbox wipe is not available via API (report as manual).

Skill: [`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/).
Long-form docs: [`docs/guesty-demo-cleanup.md`](docs/guesty-demo-cleanup.md).
Agent instructions: [`AGENTS.md`](AGENTS.md).

## Setup

```bash
cp .env.example .env
# put DEMO GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env
npm install
npm run token -- --write   # curl OAuth → writes GUESTY_ACCESS_TOKEN
```

`.env` is gitignored. Never commit tokens.

Prefer the **demo** account credentials so cleanup cannot hit production.

## Workflow

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

Defaults:

- Guest hygiene = **names only** (`firstName` + `lastName`)
- Listing hygiene = **nickname only** (`GueStay - {City}[- {UnitType}]`; unique per Guesty)
- Never change listing **titles**, rate plans, or account settings unless explicitly asked
- Always dry-run first; never `--apply` without confirmation

## Project layout

- `src/guesty/` — auth config + write client for cleanup
- `src/cleanup/` — mutation plan apply (dry-run / apply)
- `scripts/cleanup/` — cleanup CLIs (export, rename guests/nicknames, apply plan)
- `scripts/get-token.sh` — OAuth token refresh
- `.cursor/skills/guesty-demo-cleanup/` — Cursor skill + zero-state policy
- `docs/guesty-demo-cleanup.md` — shareable cleanup runbook
- `AGENTS.md` — agent instructions for this repo

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run token -- --write` | OAuth → `.env` `GUESTY_ACCESS_TOKEN` |
| `npm run cleanup:export-guests` | Full guest export → `guests-export.json` |
| `npm run cleanup:rename-guests` | Dry-run guest bulk rename |
| `npm run cleanup:rename-guests -- --apply` | Apply guest names-only PUTs |
| `npm run cleanup:rename-listing-nicknames` | Dry-run listing nickname plan |
| `npm run cleanup:rename-listing-nicknames -- --apply` | Apply nickname-only PUTs |
| `npm run cleanup:apply -- --plan mutation-plan.json` | Dry-run reservation/sanitize plan |
| `npm run cleanup:apply -- --plan mutation-plan.json --apply` | Apply plan writes |
| `npm run next-reservation` | Intake smoke: listing → next reservation |
| `npm test` / `npm run typecheck` | Unit tests / TypeScript check |
