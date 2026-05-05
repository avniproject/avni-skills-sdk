#!/usr/bin/env bash
# verify.sh — runs every verification level the SDK supports.
# Usage:
#   AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
#   ANTHROPIC_API_KEY=sk-ant-... AVNI_SKILLS_PATH=... bash scripts/verify.sh
#
# Levels 1-5 require no API key. Level 6 needs ANTHROPIC_API_KEY.

set -e
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

if [ -z "${AVNI_SKILLS_PATH:-}" ]; then
  if [ -d "$SDK_DIR/../avni-skills" ]; then
    export AVNI_SKILLS_PATH="$SDK_DIR/../avni-skills"
  else
    echo "AVNI_SKILLS_PATH not set, and ../avni-skills not found." >&2; exit 2
  fi
fi
echo "Using AVNI_SKILLS_PATH=$AVNI_SKILLS_PATH"
echo ""

PORT="${PORT:-3030}"
BASE="http://localhost:$PORT"

#─── L1 ─────────────────────────────────────────
echo "═══ L1 — entity tests ═══"
npm test 2>&1 | grep -E "tests|pass|fail" | head -3
echo ""

#─── start server ─────────────────────────────────
lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true
PORT=$PORT node src/server.js > /tmp/avni-sdk-verify.log 2>&1 &
SDK_PID=$!
trap "kill $SDK_PID 2>/dev/null; wait 2>/dev/null" EXIT
sleep 2

#─── L2 ─────────────────────────────────────────
echo "═══ L2 — /health ═══"
curl -sf "$BASE/health" && echo " ✓" || { echo " ✗"; exit 1; }
echo ""

#─── L3 ─────────────────────────────────────────
echo "═══ L3 — /v1/skills ═══"
COUNT=$(curl -sf "$BASE/v1/skills" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).skills.length")
echo "  $COUNT skills found"
echo ""

#─── L4 ─────────────────────────────────────────
echo "═══ L4 — /v1/skills/:slug ═══"
for slug in srs-bundle-generator backend-architecture; do
  curl -sf "$BASE/v1/skills/$slug" > /dev/null && echo "  ✓ $slug" || echo "  ✗ $slug"
done
echo ""

#─── L5 ─────────────────────────────────────────
echo "═══ L5 — /v1/bundles/generate ═══"
node -e "
const XLSX = require('$AVNI_SKILLS_PATH/node_modules/xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['Field Name','Data Type','Pre added Options Datatype','Mandatory (default No)'],
  ['Beneficiary Name','Text','','Yes'],
  ['Date of Birth','Date','','Yes'],
]);
XLSX.utils.book_append_sheet(wb, ws, 'Beneficiary Registration');
XLSX.writeFile(wb, '/tmp/avni-sdk-synth-forms.xlsx');
"
curl -sf -X POST "$BASE/v1/bundles/generate" \
  -F "forms=@/tmp/avni-sdk-synth-forms.xlsx" \
  -F "org=VerifyTest" \
  -D /tmp/avni-sdk-verify-headers.txt \
  -o /tmp/avni-sdk-verify.zip
SIZE=$(ls -l /tmp/avni-sdk-verify.zip | awk '{print $5}')
unzip -t /tmp/avni-sdk-verify.zip > /dev/null && INTEG="OK" || INTEG="BAD"
ERRS=$(grep "X-Bundle-Errors" /tmp/avni-sdk-verify-headers.txt | tr -d '\r' | awk '{print $2}')
echo "  ZIP=${SIZE}B integrity=$INTEG  validator-errors=$ERRS"
echo ""

#─── L6 ─────────────────────────────────────────
echo "═══ L6 — /v1/agent/query ═══"
echo "  401 reject (no key):"
curl -s -X POST "$BASE/v1/agent/query" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"hi"}' | head -c 150
echo ""
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "  Live agent run (10s smoke):"
  timeout 30 curl -sN -X POST "$BASE/v1/agent/query" \
    -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"List the avni-skills you have access to. Reply concisely."}' \
    | head -c 600
  echo ""
else
  echo "  (set ANTHROPIC_API_KEY to run a real agent query)"
fi

echo ""
echo "═══ ALL CHECKS DONE ═══"
