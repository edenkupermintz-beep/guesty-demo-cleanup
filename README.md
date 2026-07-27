# Apprentice clean up agent

## NOTE: THIS SKILL IS PUBLISHED FOR INTERNAL USE ONLY. CONTACT SALES ENGINEERING TO RUN THIS SKILL ON THE SALES DEMO ACCOUNT. EVERY OTHER GUESTY ACCOUNT IS FAIR GAME - RUN AT YOUR OWN RISK.

**Apprentice** is the Cursor agent for this repo. It cleans the Guesty Sales demo account (or any account you point it at via OAuth credentials) using the Guesty MCP and the Open API.

It cleans operational clutter: guest names, listing **nicknames**, excess **tasks**, and junk reservations.

To get started, simply invoke the skill via **`/apprentice`**.

Skill: [`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/).

Long-form docs: [`docs/guesty-demo-cleanup.md`](docs/guesty-demo-cleanup.md).

Agent instructions: [`AGENTS.md`](AGENTS.md)

## Setup

```bash
cp .env.example .env
# put DEMO GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env
npm install
npm run token -- --write   # curl OAuth → writes GUESTY_ACCESS_TOKEN
```

`.env` is gitignored. Never commit tokens.

If `.env` / credentials are missing, **Apprentice asks you** for demo
`GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET`, writes `.env`, and continues
(without echoing secrets).

## Workflow

```bash
npm run token -- --write
npm run cleanup:audit                         # value vs threshold per area; MET → propose
# Only for areas that exceed audit thresholds:
npm run cleanup:export-guests
npm run cleanup:rename-guests                 # dry-run; confirm before apply
npm run cleanup:rename-guests -- --apply      # names-only PUT
npm run cleanup:rename-listing-nicknames      # dry-run nicknames (titles untouched)
npm run cleanup:rename-listing-nicknames -- --apply
npm run cleanup:export-tasks
npm run cleanup:plan-delete-tasks             # keep 50/title → tasks-delete-plan.json
npm run cleanup:delete-tasks -- --apply       # confirm first

# Optional reservation / sanitize plan (confirm first):
npm run cleanup:apply -- --plan mutation-plan.json
npm run cleanup:apply -- --plan mutation-plan.json --apply
```

Defaults:

- **Audit first** — only propose guests / nicknames / tasks when dirty ≥ threshold (`zero-state.json` → `audit`)
- Guest hygiene = **names only** (`firstName` + `lastName`)
- Listing hygiene = **nickname only** (`GueStay - {City}[- {UnitType}]`; unique per Guesty)
- Task hygiene = **DELETE** excess instances; keep max 50 per title (see `zero-state.json`)
- Never change listing **titles**, rate plans, or account settings unless explicitly asked
- Always dry-run first; never `--apply` without confirmation

## Project layout

- `src/guesty/` — auth config + write client for cleanup
- `src/cleanup/` — mutation plan apply (dry-run / apply)
- `scripts/cleanup/` — cleanup CLIs (export, rename guests/nicknames, apply plan)
- `scripts/get-token.sh` — OAuth token refresh
- `.cursor/skills/guesty-demo-cleanup/` — Cursor skill + zero-state policy
- `docs/guesty-demo-cleanup.md` — shareable cleanup runbook
- `AGENTS.md` — **Apprentice** agent instructions for this repo

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run token -- --write` | OAuth → `.env` `GUESTY_ACCESS_TOKEN` |
| `npm run cleanup:audit` | Dirty audit vs thresholds → `audit-report.json` |
| `npm run cleanup:export-guests` | Full guest export → `guests-export.json` |
| `npm run cleanup:rename-guests` | Dry-run guest bulk rename |
| `npm run cleanup:rename-guests -- --apply` | Apply guest names-only PUTs |
| `npm run cleanup:rename-listing-nicknames` | Dry-run listing nickname plan |
| `npm run cleanup:rename-listing-nicknames -- --apply` | Apply nickname-only PUTs |
| `npm run cleanup:export-tasks` | Full task export → `tasks-export.json` |
| `npm run cleanup:plan-delete-tasks` | Build delete plan (keep 50/title) |
| `npm run cleanup:delete-tasks -- --apply` | DELETE planned excess tasks |
| `npm run cleanup:apply -- --plan mutation-plan.json` | Dry-run reservation/sanitize plan |
| `npm run cleanup:apply -- --plan mutation-plan.json --apply` | Apply plan writes |
| `npm run next-reservation` | Intake smoke: listing → next reservation |
| `npm test` / `npm run typecheck` | Unit tests / TypeScript check |
