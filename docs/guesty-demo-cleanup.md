# Apprentice — Guesty demo account cleanup

**Apprentice** is the Cursor agent that runs this hygiene. Periodic / on-request
cleanup for a heavily used **sales demo** Guesty account. Preserve rate plans and
core setup. Clean operational clutter (guest names, listing **nicknames**, excess
**tasks**, junk reservations). Report inbox debt that the API cannot wipe.

This document is the shareable version of the Cursor skill at
`.cursor/skills/guesty-demo-cleanup/` in the `guesty-demo-cleanup` repo.

This repository is **cleanup-only**.

---

## Prerequisites

```bash
cp .env.example .env
# Put DEMO GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env
npm install
```

If credentials are missing when Apprentice runs, it **asks the user** for demo
`GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET`, writes gitignored `.env`, and
continues (secrets are not echoed back in chat).

Never commit `.env`, `guests-export.json`, `guest-rename-*.json`,
`listing-nickname-*.json`, `listing-title-*.json`, or `mutation-plan.json`.

Prefer the **demo** account credentials so cleanup cannot hit production.
Scripts report `tokenConfigured` only — never print the full Open API token.

### Auth split

| Path | Token source | Capability |
|------|--------------|------------|
| Audit (spot checks) | Guesty MCP (`set_token` / MCP `BEARER_TOKEN`) | Read-only discovery |
| Export / apply | Local gitignored `.env` | Open API GET + PUT writes |

---

## Policy (zero-state)

Load `.cursor/skills/guesty-demo-cleanup/zero-state.json` before proposing mutations.

### Never touch

- Listing **titles** (unless explicitly requested)
- Rate plans / strategies
- Owners
- Accounting categories
- Payment providers
- Account settings

### Allowed hygiene

| Area | Default behavior |
|------|------------------|
| **Listing nicknames** | `PUT /listings/{id}` with `{ nickname }` only — format `GueStay - {City}` / `GueStay - {City} - {UnitType}` |
| **Guests** | Names only — `PUT /guests/{id}` with `firstName` + `lastName`. Do **not** clear notes, emails, phones, or reservation links unless explicitly asked |
| **Reservations** | Skip allowlisted codes/IDs; skip terminal statuses; skip channel-managed when `skipChannelManaged` is true (list as manual). Otherwise `closed`/`declined` for inquiries, `canceled` for confirmed demo junk |
| **Inbox** | Report only — archive manually in Guesty UI |

### Nickname format rules

| Case | Nickname |
|------|----------|
| One listing in city | `GueStay - {City}` |
| Multiple in city | `GueStay - {City} - {UnitType}` (Apartment, Condo, Loft, Penthouse, …) |
| Shared multi-unit cities (e.g. Atlanta) | Prefer shared base `GueStay - {City}`; API uniqueness may force `GueStay - Atlanta 2` |

Guesty requires **unique nicknames** account-wide. Exact duplicates are rejected.
Scripts append ` 2`, ` 3`, … when needed and save `before` nicknames in the plan for revert.

---

## Recurring playbook

### 1. Refresh token

```bash
npm run token -- --write
```

### 2. Audit (always — gate all hygiene)

```bash
npm run cleanup:audit
```

Writes `audit-report.json`. Report every gated area with **value**, **threshold**, and **MET** / **NOT MET**. Only continue dry-run / apply for areas in `propose`.

Default thresholds (`audit.thresholds`): guests renameCount ≥ 10, listing nicknames renameCount ≥ 3, tasks deleteCount ≥ 100, custom fields dirtyCount ≥ 1.

### 3. Export guests (only if guests proposed)

```bash
npm run cleanup:export-guests
```

Writes gitignored `guests-export.json`. Optionally spot-check via Guesty MCP
(`accountGet`, `guestsList`, `reservationsList`, `inboxConversationsList`) —
cap pages; ask before deep MCP export.

### 4. Bulk rename junk / duplicate guest names

Only if audit guests is MET. Dry-run (default) builds `guest-rename-plan.json` and prints counts + sample:

```bash
npm run cleanup:rename-guests
```

**Stop.** Show rename count + a short sample. Wait for explicit confirmation before apply.

```bash
npm run cleanup:rename-guests -- --apply
```

Rules: American Title Case names; group labels (Wedding Party / Team Trip / …);
collapse heavy duplicates (≥ 5 identical full names); avoid forbidden substrings;
**PUT firstName/lastName only**.

Exit codes: `0` success, `1` usage/config/parse error, `2` one or more PUTs failed.

### 5. Rename listing nicknames (titles untouched)

Only if audit listingNicknames is MET.

```bash
npm run cleanup:rename-listing-nicknames           # dry-run → listing-nickname-plan.json
# Stop — confirm sample
npm run cleanup:rename-listing-nicknames -- --apply
```

**Do not** change listing `title` unless explicitly asked (titles are marketing copy;
nicknames are internal labels).

**Revert:** plan file stores `before` nicknames. PUT each listing’s `before`
(skip rows with null `before`). Keep plan files gitignored.

### 6. Tasks — export, plan, delete (prefer delete)

Only if audit tasks is MET.

```bash
npm run cleanup:export-tasks
npm run cleanup:plan-delete-tasks
# → tasks-delete-plan.json (keep max 50 per title by default)
# Stop — confirm keep/delete counts + top titles
npm run cleanup:delete-tasks -- --apply --concurrency 2 --delay-ms 100
```

Prefer **DELETE** over cancel. Keep sparse demo volume (`tasks.keepPerTitle` in
zero-state). Instance delete does not stop recurring series or auto-tasks —
report UI: Edit task series; Properties → Automation → Auto-tasks.

### 7. Custom fields — enforce demo catalog

Only if audit customFields is MET.

```bash
npm run cleanup:plan-custom-fields
# → custom-fields-plan.json
# Stop — confirm delete / fix / create counts + sample
npm run cleanup:apply-custom-fields -- --apply
```

Enforce `customFields.catalog` (10 listing+reservation definitions). Delete extras,
create missing, fix enum options. Definitions only.

### 8. Optional: reservation / sanitize plan

1. Audit reservations / guests vs zero-state policy.
2. Propose a mutation plan (table + JSON).
3. **Stop.** Wait for explicit confirmation.
4. Write gitignored `mutation-plan.json`.
5. Dry-run then apply:

```bash
npm run cleanup:apply -- --plan mutation-plan.json
npm run cleanup:apply -- --plan mutation-plan.json --apply
```

Example schema: `scripts/cleanup/mutation-plan.example.json`.

### 9. Report

Surface successes, failures, and remaining manual inbox/channel/series work.
Do not invent API results — use script JSON output only.
Always include audit MET / NOT MET lines with numbers.
---

## Safety defaults

- Default is propose + dry-run; never `--apply` without confirmation.
- Guest hygiene = **names-only PUT**. Clearing notes / emails / phones requires an explicit request.
- Listing hygiene = **nickname-only PUT**. Never title/rate/catalog by default.
- Task hygiene = **DELETE** excess instances; keep sparse demo volume per title.
- Custom fields = enforce catalog (delete / create / fix enum options). Definitions only.
- Do not send inbox messages as cleanup.
- On Open API errors, surface exact script error text; stop batching if preferred.
- Channel reservations: list as manual unless platform is in `safeCancelPlatforms` (default: `manual`, `direct`).

---

## npm scripts cheat sheet

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

---

## API capabilities and limits

| Area | Supported via Open API | Notes |
|------|------------------------|-------|
| Cancel / close / decline reservation | Yes — `PUT /reservations/{id}` `{ "status": "canceled"\|"closed"\|"declined" }` | Channel bookings often must be canceled in channel extranets |
| Update guest name | Yes — `PUT /guests/{id}` `{ firstName, lastName }` | **Default guest hygiene.** No public delete-guest endpoint |
| Update guest notes | Yes — optional `notes` / `goodToKnowNotes` | Only when explicitly asked |
| Update listing **nickname** | Yes — `PUT /listings/{id}` `{ nickname }` | **Default listing hygiene.** Must be unique account-wide |
| Update listing **title** | Yes — `PUT /listings/{id}` `{ title }` | 50-char limit; test listings need `Test_` prefix. **Not** default hygiene |
| Delete task instances | Yes — `DELETE /tasks-open-api/{id}` | Prefer delete over cancel. Keep max N per title for demos |
| Account custom-field definitions | Yes — `GET/POST/PUT/DELETE /accounts/{id}/custom-fields` | Enforce zero-state catalog (listing + reservation) |
| Recurring series / auto-tasks | **No** public series-cancel API | UI: Edit task series; Auto-tasks |
| Delete / archive inbox conversations | **No** | Report only; archive in Guesty UI |
| Rate catalog / owners / account settings | Out of scope | Never mutate in this skill |

---

## Mutation plan schema (`mutation-plan.json`)

For optional reservation cancel / explicit sanitize (not bulk rename paths):

```json
{
  "version": 1,
  "createdAt": "ISO-8601",
  "mutations": [
    {
      "type": "reservation_status",
      "id": "<reservationId>",
      "status": "canceled",
      "confirmationCode": "optional",
      "reason": "optional"
    },
    {
      "type": "sanitize_guest",
      "id": "<guestId>",
      "firstName": "Demo",
      "lastName": "Guest",
      "clearNotes": true,
      "clearGoodToKnowNotes": true,
      "reason": "optional"
    }
  ],
  "manual": [
    { "kind": "inbox", "summary": "Archive thread … in Guesty UI" },
    { "kind": "channel_reservation", "id": "…", "summary": "Cancel on Airbnb extranets" }
  ]
}
```

---

## Operational notes

- Many London properties may share the same marketing title — disambiguate by **nickname** / listing id.
- `filter[checkIn][gte]=today` hides past stays.
- Guest names-only PUTs do not break reservation links.
- Guest PUT can 400 if stored phone is invalid — clear phone only with explicit OK.
- Prefer nicknames for GueStay labeling; titles are guest-facing marketing copy.

---

## Code map (repo)

| Path | Role |
|------|------|
| `src/guesty/write-client.ts` | PUT helpers (guest names, listing nickname, reservation status) |
| `src/cleanup/apply.ts` | Mutation plan apply / dry-run |
| `scripts/cleanup/apply-plan.ts` | Reservation/sanitize CLI |
| `scripts/cleanup/export-guests.ts` | Full guest export |
| `scripts/cleanup/bulk-rename-guests.ts` | Guest names-only rename |
| `scripts/cleanup/rename-listing-nicknames.ts` | Listing nickname rename |
| `scripts/get-token.sh` | OAuth → optional `--write` into `.env` |
| `.cursor/skills/guesty-demo-cleanup/zero-state.json` | Policy + allowlists |
| `.cursor/skills/guesty-demo-cleanup/SKILL.md` | Cursor agent skill |
| `.cursor/skills/guesty-demo-cleanup/reference.md` | Agent reference |

---

## Reporting checklist

After a cleanup run, surface:

1. Audit: each area’s value, threshold, MET / NOT MET (from `audit-report.json`)
2. Whether hygiene work is needed (junk/dupe names, nicknames, junk reservations, inbox)
3. Planned counts + sample before/after
4. After apply: success/failure from script JSON (`tokenConfigured`, never the token)
