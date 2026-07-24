# Guesty demo cleanup — reference

## API capabilities and limits

| Area | Supported via Open API | Notes |
|------|------------------------|-------|
| Cancel / close / decline reservation | Yes — `PUT /reservations/{id}` `{ "status": "canceled"\|"closed"\|"declined" }` | Channel bookings often must be canceled in the channel extranets |
| Update guest name | Yes — `PUT /guests/{id}` `{ firstName, lastName }` | **Default guest hygiene.** No public delete-guest endpoint |
| Update guest notes | Yes — optional `notes` / `goodToKnowNotes` | Only when the user explicitly asks |
| Update listing **nickname** | Yes — `PUT /listings/{id}` `{ nickname }` | **Default listing hygiene.** Must be unique account-wide |
| Update listing **title** | Yes — `PUT /listings/{id}` `{ title }` | 50-char limit; test listings need `Test_` prefix. **Not** default hygiene |
| Delete / archive inbox conversations | **No** | Report only; archive in Guesty UI |
| Rate catalog / owners / account settings | Out of scope | Never mutate in this skill |

## Guest bulk rename

```bash
npm run cleanup:export-guests
npm run cleanup:rename-guests
npm run cleanup:rename-guests -- --apply
```

Exit codes: `0` success, `1` usage/config/parse error, `2` one or more PUTs failed.

Targeting: junk patterns, forbidden substrings, group-style names, heavy duplicates
(≥ 5). Writes **only** `firstName` + `lastName`.

## Listing nickname rename

```bash
npm run cleanup:rename-listing-nicknames
# → listing-nickname-plan.json (before/after for revert)

npm run cleanup:rename-listing-nicknames -- --apply
# → listing-nickname-results.json
```

### Naming rules (`scripts/cleanup/rename-listing-nicknames.ts`)

1. Resolve city from `address.city` (fallback heuristics on `address.full`).
2. **Single** listing in that city → `GueStay - {City}`.
3. **Multiple** listings → `GueStay - {City} - {UnitType}` where unit type is
   inferred from title/nickname/`propertyType` when possible, else from a pool
   (Apartment, Condo, Loft, Penthouse, Studio, Suite, Townhouse, Villa, …).
   Prefer ≤ 3 listings aiming at the same base pattern before rotating types.
4. **Shared multi-unit cities** (default: `Atlanta` in
   `SHARED_NICKNAME_CITIES`) → all use base `GueStay - {City}` (no unit type).
5. **Uniqueness:** Guesty rejects duplicate nicknames. Script appends ` 2`, ` 3`, …
   when the base is taken (including Atlanta children after the first).

**Titles are never sent** in this script.

### Revert

Plan file stores `before` nicknames. To revert, `PUT` each listing’s `before`
(skip rows with null `before`). Keep `listing-nickname-plan.json` gitignored.

### Live lesson

We briefly applied **titles** by mistake; reverted from `listing-title-plan.json`
`before` values. Prefer nicknames for GueStay labeling — titles are guest-facing
marketing copy.

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

Example: `scripts/cleanup/mutation-plan.example.json`.

## Reservation / sanitize CLI

```bash
npm run cleanup:apply -- --plan mutation-plan.json
npm run cleanup:apply -- --plan mutation-plan.json --apply
```

## MCP audit tools (read-only)

`accountGet`, `reservationsList`, `guestsList`, `guestsGet`, `propertiesList`,
`inboxConversationsList`, `inboxConversationPostsList`.

Follow Guesty MCP PVE. Cap pagination; ask before deep export.

## Other live lessons

- Many London properties share marketing title `"London lofts - Chic Urban get away"` —
  disambiguate by **nickname** / listing id.
- `filter[checkIn][gte]=today` hides past stays.
- Guest names-only PUTs do not break reservation links.
- Guest PUT can 400 if stored phone is invalid — clear phone only with user OK.

## Code map

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
