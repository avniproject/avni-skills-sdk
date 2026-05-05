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
  echo "  Live agent run (90s timeout, full stream → /tmp/avni-sdk-l6-stream.log):"
  curl -sN --max-time 90 -X POST "$BASE/v1/agent/query" \
    -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"List the 16 avni skills available. For each, give a one-line description. Use the Skill or Read tool — do not answer from memory."}' \
    > /tmp/avni-sdk-l6-stream.log

  # Summarize the stream — count events, show text content, flag issues
  node - <<'NODE_EOF' /tmp/avni-sdk-l6-stream.log
  const fs = require("node:fs");
  const raw = fs.readFileSync(process.argv[2], "utf8");
  const events = [];
  for (const block of raw.split(/\n\n+/)) {
    const ev = (block.match(/^event: (\S+)/m) || [,null])[1];
    const data = (block.match(/^data: (.*)$/m) || [,null])[1];
    if (ev && data) { try { events.push({ ev, data: JSON.parse(data) }); } catch {} }
  }
  console.log(`    total SSE events: ${events.length}`);

  const counts = {};
  for (const e of events) {
    const tag = e.ev === "agent" ? `agent.${e.data.type || "?"}` : e.ev;
    counts[tag] = (counts[tag] || 0) + 1;
  }
  for (const [k, v] of Object.entries(counts)) console.log(`      ${k}: ${v}`);

  const toolCalls = events.filter(e => e.ev === "agent" && e.data.type === "assistant")
    .flatMap(e => (e.data.message?.content || [])
      .filter(c => c.type === "tool_use")
      .map(c => ({ name: c.name, input: c.input })));
  console.log(`    tool calls: ${toolCalls.length}`);
  toolCalls.slice(0, 8).forEach(tc => {
    const i = JSON.stringify(tc.input).slice(0, 100);
    console.log(`      • ${tc.name} ${i}`);
  });

  const texts = events.filter(e => e.ev === "agent" && e.data.type === "assistant")
    .flatMap(e => (e.data.message?.content || []).filter(c => c.type === "text").map(c => c.text));
  if (texts.length) {
    console.log(`    final text (${texts.join("").length} chars):`);
    const out = texts.join("\n");
    console.log(out.split("\n").slice(0, 25).map(l => "      " + l).join("\n"));
    if (out.split("\n").length > 25) console.log(`      ...(${out.split("\n").length - 25} more lines in /tmp/avni-sdk-l6-stream.log)`);
  } else {
    console.log("    no assistant text emitted — agent may have errored before responding");
  }

  const result = events.find(e => e.ev === "agent" && e.data.type === "result");
  if (result) {
    console.log(`    result: stop_reason=${result.data.stop_reason || "?"}`);
    if (result.data.usage) console.log(`    usage: ${JSON.stringify(result.data.usage)}`);
    if (result.data.total_cost_usd != null) console.log(`    cost: $${result.data.total_cost_usd}`);
  }

  const errs = events.filter(e => e.ev === "error");
  if (errs.length) {
    console.log("    ✗ errors:");
    errs.forEach(e => console.log(`      ${JSON.stringify(e.data)}`));
  } else {
    console.log("    ✓ no errors");
  }
NODE_EOF
else
  echo "  (set ANTHROPIC_API_KEY to run a real agent query)"
fi

echo ""
echo "═══ ALL CHECKS DONE ═══"
