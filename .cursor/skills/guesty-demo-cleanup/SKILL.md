---
name: guesty-demo-cleanup
description: >-
  Recurring sales-demo hygiene for Guesty: refresh Open API token, export/audit
  guests, bulk-rename junk/duplicate guest names (names-only PUT), rename listing
  nicknames to GueStay - City[- UnitType], optionally cancel junk reservations
  per zero-state after confirmation. Use when the user asks to clean, reset,
  sanitize, or periodically tidy a Guesty demo account — guests, listing
  nicknames, reservations, or inbox clutter.
---

# Guesty demo account cleanup (recurring hygiene)

Periodic / on-request cleanup for a heavily used **sales demo** Guesty account.
Preserve rate plans and core setup. Clean operational clutter (guest names,
listing **nicknames**, junk reservations). Report inbox debt that the API cannot wipe.

This repository is **cleanup-only**.

## Prerequisites

```bash
cp .env.example .env
# Put DEMO GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env
npm install
```

Never commit `.env`, `guests-export.json`, `guest-rename-*.json`,
`listing-nickname-*.json`, `listing-title-*.json`, or `mutation-plan.json`.

Prefer the **demo** account credentials so cleanup cannot hit production.
Never print the full Open API token in chat or CLI output (scripts report
`tokenConfigured` only).

## Auth split (critical)

| Path | Token source | Capability |
|------|--------------|------------|
| Audit (spot checks) | Guesty MCP (`set_token` / MCP `BEARER_TOKEN`) | Read-only discovery |
| Export / apply | Local gitignored `.env` | Open API GET + PUT writes |

## Policy

Load [zero-state.json](zero-state.json) before proposing mutations.

- **Never touch:** listing **titles** (unless user explicitly asks), rate
  plans/strategies, owners, accounting categories, payment providers, account settings.
- **Listing nicknames (allowed hygiene):** `PUT /listings/{id}` with `{ nickname }`
  only — format `GueStay - {City}` / `GueStay - {City} - {UnitType}`. See below.
- **Guests (default hygiene):** **names only** — `PUT /guests/{id}` with
  `firstName` + `lastName`. Do **not** clear notes, emails, phones, or reservation
  links unless the user explicitly asks.
- **Reservations:** skip allowlisted confirmation codes / IDs; skip already-terminal
  statuses; skip channel-managed bookings when `skipChannelManaged` is true (list as
  manual); otherwise `closed`/`declined` for inquiries, `canceled` for confirmed
  demo junk.
- **Inbox:** report only — archive manually in Guesty UI.

## Recurring playbook (run every so often)

### 1. Refresh token

```bash
npm run token -- --write
```

### 2. Export guests (audit input)

```bash
npm run cleanup:export-guests
```

Writes gitignored `guests-export.json`. Optionally spot-check via Guesty MCP
(`accountGet`, `guestsList`, `reservationsList`, `inboxConversationsList`) —
cap pages; ask before deep MCP export.

### 3. Bulk rename junk / duplicate guest names

Dry-run (default) builds `guest-rename-plan.json` and prints counts + sample:

```bash
npm run cleanup:rename-guests
```

**Stop.** Show the user rename count + a short sample. Wait for explicit “yes”
before apply.

```bash
npm run cleanup:rename-guests -- --apply
```

Rules: American Title Case names; group labels (Wedding Party / Team Trip / …);
collapse heavy duplicates; avoid forbidden substrings; **PUT firstName/lastName only**.

### 4. Rename listing nicknames (titles untouched)

Same city / unit-type logic used in live demo work:

| Case | Nickname |
|------|----------|
| One listing in city | `GueStay - {City}` |
| Multiple in city | `GueStay - {City} - {UnitType}` (Apartment, Condo, Loft, Penthouse, …) |
| Shared multi-unit cities (e.g. Atlanta) | Prefer shared base `GueStay - {City}`; API uniqueness may force `GueStay - Atlanta 2` |

```bash
npm run cleanup:rename-listing-nicknames           # dry-run → listing-nickname-plan.json
# Stop — confirm sample with user
npm run cleanup:rename-listing-nicknames -- --apply
```

**Critical:** Guesty requires **unique nicknames** account-wide. Exact duplicates
are rejected (`A listing with the nickname you chose already exists`). The script
appends ` 2`, ` 3`, … when needed. Save `before` nicknames in the plan for revert.

**Do not** change listing `title` unless the user explicitly asks (demo titles are
marketing copy; nicknames are the internal labels).

### 5. Optional: reservation / sanitize plan (confirm-before-apply)

1. Audit reservations / guests vs [zero-state.json](zero-state.json).
2. Propose a mutation plan (table + JSON).
3. **Stop.** Wait for explicit confirmation.
4. Write gitignored `mutation-plan.json`.
5. Dry-run then apply via `npm run cleanup:apply`.

### 6. Report

Surface successes, failures, remaining manual inbox/channel work. Do not invent
API results — use script JSON output only (`tokenConfigured`, never the token).

## Safety defaults

- Default is propose + dry-run; never `--apply` without user confirmation.
- Guest hygiene default = **names-only PUT**. Clearing notes / emails / phones
  requires an explicit user request.
- Listing hygiene default = **nickname-only PUT**. Never title/rate/catalog.
- Do not send inbox messages as cleanup.
- On Open API errors, surface exact script error text; stop batching if the user prefers.
- Channel reservations: list as manual unless platform is in `safeCancelPlatforms`.

## npm scripts cheat sheet

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

## Output format

1. Whether hygiene work is needed (junk/dupe names, nicknames, junk reservations, inbox)
2. Planned counts + sample before/after
3. After apply: success/failure from script JSON

See [reference.md](reference.md) for API limits, nickname uniqueness, and code map.
