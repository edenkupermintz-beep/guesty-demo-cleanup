#!/usr/bin/env bash
# Exchange Guesty OAuth client credentials for a bearer token.
# Usage:
#   npm run token              # print JSON (access_token, expires_in, …)
#   npm run token -- --write   # also update GUESTY_ACCESS_TOKEN in .env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and set GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

CLIENT_ID="${GUESTY_CLIENT_ID:-${CLIENT_ID:-}}"
CLIENT_SECRET="${GUESTY_CLIENT_SECRET:-${CLIENT_SECRET:-}}"
TOKEN_URL="${GUESTY_OAUTH_TOKEN_URL:-https://open-api.guesty.com/oauth2/token}"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Set GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET (or CLIENT_ID / CLIENT_SECRET) in .env" >&2
  exit 1
fi

WRITE=0
for arg in "$@"; do
  case "$arg" in
    --write|-w) WRITE=1 ;;
    --help|-h)
      echo "Usage: npm run token [-- --write]"
      exit 0
      ;;
  esac
done

RESP="$(curl -sS -X POST "$TOKEN_URL" \
  -H "Accept: application/json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=open-api" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}")"

if ! printf '%s' "$RESP" | grep -q '"access_token"'; then
  echo "Token exchange failed:" >&2
  echo "$RESP" >&2
  exit 1
fi

if [[ "$WRITE" -eq 1 ]]; then
  TOKEN="$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(!j.access_token)process.exit(2);process.stdout.write(j.access_token)})")"
  if grep -q '^GUESTY_ACCESS_TOKEN=' .env; then
    # Replace existing line without printing the token
    node -e "
      const fs = require('fs');
      const token = process.argv[1];
      let text = fs.readFileSync('.env','utf8');
      if (/^GUESTY_ACCESS_TOKEN=/m.test(text)) {
        text = text.replace(/^GUESTY_ACCESS_TOKEN=.*$/m, 'GUESTY_ACCESS_TOKEN=' + token);
      } else {
        text = text.trimEnd() + '\nGUESTY_ACCESS_TOKEN=' + token + '\n';
      }
      fs.writeFileSync('.env', text.endsWith('\n') ? text : text + '\n');
    " "$TOKEN"
  else
    printf '\nGUESTY_ACCESS_TOKEN=%s\n' "$TOKEN" >> .env
  fi
  echo "Updated GUESTY_ACCESS_TOKEN in .env (token not printed)."
  EXPIRES="$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);process.stdout.write(String(j.expires_in??''))})")"
  if [[ -n "$EXPIRES" ]]; then
    echo "expires_in=${EXPIRES}s"
  fi
else
  echo "$RESP"
fi
