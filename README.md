# Guesty demo account tools

This repo has **two separate tools** for Guesty demo accounts:

| Tool | Purpose |
|------|---------|
| **Apprentice** (cleanup) | Remove operational clutter from a demo account |
| **Faker** (`faker/`) | Seed fake confirmed reservations into a demo account |

They do not share a workflow. Cleanup does not call faker, and faker does not run cleanup.

## NOTE: THE CLEANUP SKILL IS PUBLISHED FOR INTERNAL USE ONLY. CONTACT SALES ENGINEERING TO RUN IT ON THE SALES DEMO ACCOUNT. EVERY OTHER GUESTY ACCOUNT IS FAIR GAME - RUN AT YOUR OWN RISK.

---

## Apprentice (cleanup)

**Apprentice** is the Cursor agent for demo hygiene. It cleans the Guesty Sales demo account (or any account you point it at via OAuth credentials) using the Guesty MCP and the Open API.

It cleans operational clutter: guest names, listing **nicknames**, excess **tasks**,
**custom field** definitions, and junk reservations.

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
npm run cleanup:plan-custom-fields            # catalog sync plan
npm run cleanup:apply-custom-fields -- --apply  # confirm first

# Optional reservation / sanitize plan (confirm first):
npm run cleanup:apply -- --plan mutation-plan.json
npm run cleanup:apply -- --plan mutation-plan.json --apply
```

Defaults:

- **Audit first** — only propose guests / nicknames / tasks / custom fields when dirty ≥ threshold (`zero-state.json` → `audit`)
- Guest hygiene = **names only** (`firstName` + `lastName`)
- Listing hygiene = **nickname only** (`GueStay - {City}[- {UnitType}]`; unique per Guesty)
- Task hygiene = **DELETE** excess instances; keep max 50 per title (see `zero-state.json`)
- Custom fields = enforce `customFields.catalog` (listing + reservation definitions)
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
- `faker/` — **separate** reservation seeder (not part of cleanup)

## Scripts (cleanup)

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
| `npm run cleanup:plan-custom-fields` | Plan catalog sync → `custom-fields-plan.json` |
| `npm run cleanup:apply-custom-fields -- --apply` | Apply custom-field catalog sync |
| `npm run cleanup:apply -- --plan mutation-plan.json` | Dry-run reservation/sanitize plan |
| `npm run cleanup:apply -- --plan mutation-plan.json --apply` | Apply plan writes |
| `npm run next-reservation` | Intake smoke: listing → next reservation |
| `npm run faker:install` | Install deps for the faker seeder (`faker/`) |
| `npm run faker` | Seed fake reservations (uses `faker/.env` only) |
| `npm test` / `npm run typecheck` | Unit tests / TypeScript check |

---

## Faker (reservation seeder)

**Not part of Apprentice / cleanup.** Standalone script under [`faker/`](faker/) that creates fake confirmed reservations on active listings (random guests, stays in the next ~30 days).

Credentials are **separate**: Apprentice uses the repo-root `.env`; faker always loads `faker/.env` (pinned by path, independent of cwd). Point each at a different Guesty account if you want.

Setup and usage: [`faker/readme.md`](faker/readme.md). Quick start from repo root:

```bash
npm run faker:install
cp faker/.env.example faker/.env   # set that account's GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET
npm run faker
```
