# Guesty demo account cleanup agent

## Goal

Recurring / on-request hygiene for a heavily used **sales demo** Guesty account.
Preserve rate plans and core setup. Clean operational clutter (guest names, listing
**nicknames**, junk reservations). Report inbox debt that the API cannot wipe.

This repo is **cleanup-only**. Use the skill at
[`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/) and the
runbook in [`docs/guesty-demo-cleanup.md`](docs/guesty-demo-cleanup.md).

## How to run

1. Ensure `.env` exists with demo `GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET` (never commit).
2. Refresh token, then follow dry-run → confirm → apply:

```bash
npm run token -- --write
npm run cleanup:export-guests
npm run cleanup:rename-guests
npm run cleanup:rename-guests -- --apply
npm run cleanup:rename-listing-nicknames
npm run cleanup:rename-listing-nicknames -- --apply
npm run cleanup:apply -- --plan mutation-plan.json --apply   # only after confirm
```

## What to tell the user

Always surface:

1. Whether hygiene work is needed (junk/dupe names, nicknames, junk reservations, inbox)
2. Planned counts + a short before/after sample
3. After apply: success/failure from script JSON (`tokenConfigured`, never the token)
4. Remaining manual work (inbox archive, channel extranets)

Do not invent API results — use script output only.

## Policy

- Default is propose + dry-run; never `--apply` without explicit confirmation.
- Guest hygiene = **names-only PUT** (`firstName` + `lastName`). Clearing notes /
  emails / phones requires an explicit user request.
- Listing hygiene = **nickname-only PUT**. Never title/rate/catalog by default.
- Do not send inbox messages as cleanup.
- Channel reservations: list as manual unless platform is in `safeCancelPlatforms`.
- Prefer the **demo** account credentials so cleanup cannot hit production.

## Workspace rules

- Keep mutations in `src/cleanup/` and `src/guesty/write-client.ts`.
- Prefer running the cleanup CLIs over manually calling Guesty endpoints.
- Load `.cursor/skills/guesty-demo-cleanup/zero-state.json` before proposing mutations.
- Never commit `.env`, export/plan/result JSON artifacts, or tokens.
