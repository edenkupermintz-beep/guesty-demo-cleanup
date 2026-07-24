# Guesty folio delta agent

## Goal

Compare a single Guesty reservation's **guest folio `money.totalPaid`** to the **Advanced Deposit (AD)** accounting folio and report signed deltas to the user.

## How to run

1. Ensure `.env` exists with `GUESTY_ACCESS_TOKEN=...` (never commit this file). Prefer the **demo** account token when using shared tooling.
2. Reconcile by confirmation code:

```bash
npm run reconcile -- --confirmation <CONFIRMATION_CODE>
```

Or by reservation id:

```bash
npm run reconcile -- --reservation-id <RESERVATION_ID>
```

JSON output:

```bash
npm run reconcile -- --confirmation <CODE> --json
```

Exit code `2` means a material delta was found; `0` means balanced within tolerance.

## What to tell the user

Always surface:
- Whether a **delta was found**
- The **signed delta amount** and currency
- The **interpretation** (surplus vs shortfall)
- Guest `totalPaid` and AD payment credits used in the compare
- **Line-item table**: MATCH / AMOUNT≠ / GUEST ONLY / AD ONLY with per-line deltas

Do not post corrective journal entries or payments — report only.

## Formula (primary)

`delta = guest.totalPaid − AD payment credits`

- AD payment credits = sum of AD journal **credits** with trigger `PAYMENT`
- If no PAYMENT-tagged credits exist, fall back to all AD credits and say so in the report

## Line items

Match guest `money.invoiceItems` to AD rows by normalized title/description.
Statuses: `matched`, `amount_mismatch`, `guest_only`, `ad_only`.

Demo with pretend differences:

```bash
npm run demo:lines
```

## Workspace rules

- Keep math in `src/reconcile/` (deterministic). Do not invent numbers with the LLM.
- Prefer running the CLI over manually calling Guesty endpoints.
- If the API shape differs from our normalizer, dump `--json` (or capture raw errors), adjust `src/guesty/client.ts` normalizer, and re-run.

## Related: demo account cleanup (separate)

For recurring demo hygiene (token refresh, guest export/bulk rename, listing
**nickname** rename, optional reservation cancel after confirmation), use the
project skill [`.cursor/skills/guesty-demo-cleanup/`](.cursor/skills/guesty-demo-cleanup/) and:

```bash
npm run token -- --write
npm run cleanup:export-guests
npm run cleanup:rename-guests
npm run cleanup:rename-guests -- --apply
npm run cleanup:rename-listing-nicknames
npm run cleanup:rename-listing-nicknames -- --apply
npm run cleanup:apply -- --plan mutation-plan.json --apply   # only after confirm
```

Guest hygiene defaults to **names-only** PUTs. Listing hygiene defaults to
**nickname-only** PUTs (not titles). **Never** run cleanup mutations as part of
folio reconcile. Reconcile stays report-only.
