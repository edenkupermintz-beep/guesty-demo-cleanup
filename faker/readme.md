# Reservation Faker Data Generator

Standalone script to seed fake confirmed reservations into a Guesty demo account.

**Separate from Apprentice / cleanup.** Credentials live in `faker/.env` only — never the repo-root `.env`. The script always loads that file, no matter which directory you run it from.

## Setup

From the repo root (no need to `cd faker`):

```bash
npm run faker:install
cp faker/.env.example faker/.env
# put this account's GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in faker/.env
```

> **Security:** Never commit `faker/.env`. It is gitignored.

## Run

From the repo root:

```bash
npm run faker
```

Or equivalently: `npm start` inside `faker/`, or `node faker/faker.js` from anywhere — all use `faker/.env`.
