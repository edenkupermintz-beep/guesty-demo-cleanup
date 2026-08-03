# Cloner (demo set up)

Standalone script to clone a target environment from a **source (Core)** Guesty
account into a **destination (Demo)** account using the Open API.

**Separate from Apprentice / cleanup and Faker.** Credentials live in
`cloner/.env` only — never the repo-root `.env`. The script always loads that
file, no matter which directory you run it from.

Source: [natefoster-dev/cloner](https://github.com/natefoster-dev/cloner)

## Setup

From the repo root:

```bash
npm run cloner:install
cp cloner/.env.example cloner/.env
# set CORE_* (source) and DEMO_* (destination) client id/secret in cloner/.env
```

> **Security:** Never commit `cloner/.env` or token caches. They are gitignored.

## Run

From the repo root:

```bash
npm run cloner
```

Or equivalently: `npm start` inside `cloner/`, or `node cloner/cloner.js` from
anywhere — all use `cloner/.env`.

## Optional knobs

Edit the control panel at the top of `cloner.js`:

```javascript
const targetLoops = 5;              // properties to clone from Core
const reservationsPerListing = 3;   // staggered reservations per listing
```

## Token caching

On run, the script may write local token caches (gitignored):

- `.token_cache_core.json`
- `.token_cache_demo.json`
