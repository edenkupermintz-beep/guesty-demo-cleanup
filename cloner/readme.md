# Cloner (demo account set up)

Standalone toolkit to clone listing/setup data from a **source (Core)** Guesty
account into a **destination (Demo)** account via the Open API.

**Separate from Apprentice / cleanup and Faker.** Credentials live in
`cloner/.env` only — never the repo-root `.env`. Scripts always load that file,
no matter which directory you run them from.

| Script | Purpose |
|--------|---------|
| `cloner.js` | Clone properties + seed staggered reservations from Core → Demo |
| `initializer.js` | Playwright helper to spin up a new demo account in Chrome |
| `teardown.js` | Destructive purge of the Demo account (confirm carefully) |

## Setup

From the repo root:

```bash
npm run cloner:install
cp cloner/.env.example cloner/.env
# set CORE_* (source) and DEMO_* (destination) client id/secret in cloner/.env
```

> **Security:** Never commit `cloner/.env`, token caches, `state.json`, or
> `accounts.txt`. They are gitignored.

## Run

From the repo root:

```bash
npm run cloner              # clone Core → Demo
npm run cloner:init         # optional: create/open a new demo account (Chrome)
npm run cloner:teardown     # optional: purge Demo account (destructive)
```

Or equivalently inside `cloner/`: `npm start` / `npm run init` / `npm run teardown`.

## Optional knobs

Edit the control panel at the top of `cloner.js`:

```javascript
const targetLoops = 5;              // properties to clone from Core
const reservationsPerListing = 3;   // staggered reservations per listing
```
