#!/usr/bin/env bash
# End-to-end MCP check against a running dev server: sign up → org → OAuth (DCR + PKCE) → MCP tool calls.
# Usage: scripts/mcp-e2e.sh '<json-rpc tools/call params>' ...   (prints each result)
set -euo pipefail
B=${BASE_URL:-http://localhost:3000}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
J=$T/cookies; O="Origin: $B"; STAMP=$(date +%s)$RANDOM
post() { curl -sf -b "$J" -c "$J" -H "$O" -H 'content-type: application/json' "$B$1" -d "$2"; }

post /api/auth/sign-up/email "{\"email\":\"e2e-$STAMP@test.local\",\"password\":\"password123\",\"name\":\"E2E\"}" >/dev/null
post /api/auth/organization/create "{\"name\":\"E2E Org\",\"slug\":\"e2e-$STAMP\"}" >/dev/null

CID=$(curl -sf -H 'content-type: application/json' "$B/api/auth/oauth2/register" \
  -d '{"client_name":"e2e","redirect_uris":["http://localhost:9999/cb"],"token_endpoint_auth_method":"none","application_type":"native"}' |
  sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')
V=$(openssl rand -hex 32)
C=$(printf %s "$V" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
R=http%3A%2F%2Flocalhost%3A9999%2Fcb
RES=$(printf %s "$B/api/mcp" | sed 's/:/%3A/g; s#/#%2F#g')
LOC=$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{redirect_url}' \
  "$B/api/auth/oauth2/authorize?response_type=code&client_id=$CID&redirect_uri=$R&scope=openid%20offline_access&state=s&code_challenge=$C&code_challenge_method=S256&resource=$RES")
CODE=$(post /api/auth/oauth2/consent "{\"accept\":true,\"oauth_query\":\"${LOC#*\?}\"}" | sed -n 's/.*code=\([^&"]*\).*/\1/p')
AT=$(curl -sf "$B/api/auth/oauth2/token" -d grant_type=authorization_code -d "code=$CODE" \
  -d redirect_uri=http://localhost:9999/cb -d "client_id=$CID" -d "code_verifier=$V" -d "resource=$B/api/mcp" |
  sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$AT" ] || { echo "FAIL: no access token"; exit 1; }
echo "ok: signed in as e2e-$STAMP@test.local, token issued"

call() {
  curl -sf -H "authorization: Bearer $AT" -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' \
    "$B/api/mcp" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":$1}" | sed -n 's/^data: //p'
}
first_id() { { grep -o '\\"id\\": \\"[^\\]*' || true; } | head -1 | sed 's/.*\\"//'; }
# Placeholders: ORG_ID = the org created above; PROJECT_ID / DOC_ID = ids returned by the
# latest create_project / create_document call.
ORG=$(call '{"name":"list_organizations","arguments":{}}' | first_id)
PROJECT="" DOC="" TASK=""
for params in "$@"; do
  p=${params//ORG_ID/$ORG}; p=${p//PROJECT_ID/$PROJECT}; p=${p//DOC_ID/$DOC}; p=${p//TASK_ID/$TASK}
  out=$(call "$p"); echo "$out"; echo
  case $p in
    *'"create_project"'*) PROJECT=$(echo "$out" | first_id) ;;
    *'"create_document"'*) DOC=$(echo "$out" | first_id) ;;
    *'"create_tasks"'* | *'"claim_next_task"'*) id=$(echo "$out" | first_id); TASK=${id:-$TASK} ;;
  esac
done
# Keep the web session for page checks: COOKIES_OUT=path  (and print the last doc/project ids)
if [ -n "${COOKIES_OUT:-}" ]; then cp "$J" "$COOKIES_OUT"; echo "PROJECT=$PROJECT DOC=$DOC TASK=$TASK"; fi
