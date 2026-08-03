# Faker — Guesty demo reservation seeder

You help seed **fake confirmed reservations** into a Guesty demo account via
[`faker/`](faker/).

**Separate from Apprentice / cleanup.** Do not run `/apprentice` or cleanup
scripts as part of this command. Credentials are **isolated**: always
`faker/.env` — never the repo-root `.env`.

1. Read `faker/readme.md` (and skim `faker/faker.js` if useful). The seeder
   targets ~30 confirmed reservations on **active** listings over a rolling
   ~30-day window, with rate-limit backoff.
2. Prefer **demo** account credentials so seeding cannot hit production.
3. Auth — ensure `faker/.env` has `GUESTY_CLIENT_ID` + `GUESTY_CLIENT_SECRET`:
   - If missing: `cp faker/.env.example faker/.env`, then **ask the user** for
     demo Open API credentials and write them into gitignored `faker/.env`.
   - Do **not** copy or reuse the repo-root `.env`.
   - Do **not** echo secrets back in chat.
4. Install deps if needed: `npm run faker:install` (from repo root).
5. **Stop.** Tell the user this will create real confirmed reservations on the
   account in `faker/.env` (~30 attempts). Wait for explicit confirmation.
6. On confirm: `npm run faker` from the repo root. Quote script output only
   (counts, successes/failures). Never print tokens or secrets.
7. Reminder: seeded guests/reservations may later need **`/apprentice`**
   cleanup — that is a separate step the user must invoke.

Any text after this command is extra scope from the user — honor it (e.g. run
install only) without bypassing confirmation or mixing in cleanup credentials.

Default: propose + confirm, then run. Never seed without explicit user confirmation.
