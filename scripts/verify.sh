#!/usr/bin/env bash
# verify.sh — runs every verification level the SDK supports.
# Usage:
#   AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
#   ANTHROPIC_API_KEY=sk-ant-... AVNI_SKILLS_PATH=... bash scripts/verify.sh
#
# Levels:
#   L1-L5: no API key needed (entity tests, server, /health, /v1/skills, generator)
#   L6:    requires ANTHROPIC_API_KEY (single Claude session via /v1/agent/query)
#   L7:    requires ANTHROPIC_API_KEY *and* SDK_EVAL_BUDGET_USD (real-LLM eval harness)
#
# Exit code is non-zero on ANY level failure (set -e + pipefail + explicit asserts).

set -euo pipefail
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

# Track per-level failures so we can fail at the end with a useful summary
# instead of dying silently on the first hiccup. set -e still catches structural
# errors (syntax / missing commands); these arrays track *check* failures.
FAILED_LEVELS=()
fail_level() {
  echo "  ✗ $1" >&2
  FAILED_LEVELS+=("$1")
}

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
# Run npm test capturing both exit code and a summary line. Without pipefail the
# original `npm test | grep | head` happily exited 0 even when the suite blew up.
L1_LOG=/tmp/avni-sdk-verify-l1.log
if npm test > "$L1_LOG" 2>&1; then
  grep -E "tests|pass|fail" "$L1_LOG" | head -3 || true
  echo "  ✓ L1 passed"
else
  L1_CODE=$?
  echo "  npm test exited $L1_CODE — tail of log:"
  tail -30 "$L1_LOG" | sed 's/^/    /'
  fail_level "L1"
fi
echo ""

#─── start server ─────────────────────────────────
lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true
PORT=$PORT node src/server.js > /tmp/avni-sdk-verify.log 2>&1 &
SDK_PID=$!
trap "kill $SDK_PID 2>/dev/null; wait 2>/dev/null" EXIT
sleep 2

# Confirm the server actually came up before we run HTTP-dependent levels.
if ! kill -0 "$SDK_PID" 2>/dev/null; then
  echo "  ✗ server failed to start — tail of /tmp/avni-sdk-verify.log:" >&2
  tail -30 /tmp/avni-sdk-verify.log | sed 's/^/    /' >&2
  fail_level "server-boot"
fi

#─── L2 ─────────────────────────────────────────
echo "═══ L2 — /health ═══"
if curl -sf "$BASE/health" > /dev/null; then
  echo "  ✓ /health 200"
else
  fail_level "L2"
fi
echo ""

#─── L3 ─────────────────────────────────────────
echo "═══ L3 — /v1/skills ═══"
L3_BODY=$(curl -sf "$BASE/v1/skills" || true)
if [ -z "$L3_BODY" ]; then
  fail_level "L3 (empty body / curl failed)"
else
  COUNT=$(printf '%s' "$L3_BODY" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).skills.length" 2>/dev/null || echo "")
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    fail_level "L3 (skills.length=$COUNT)"
  else
    echo "  ✓ $COUNT skills found"
  fi
fi
echo ""

#─── L4 ─────────────────────────────────────────
echo "═══ L4 — /v1/skills/:slug ═══"
L4_FAIL=0
for slug in srs-bundle-generator backend-architecture; do
  if curl -sf "$BASE/v1/skills/$slug" > /dev/null; then
    echo "  ✓ $slug"
  else
    echo "  ✗ $slug"
    L4_FAIL=1
  fi
done
[ "$L4_FAIL" -eq 0 ] || fail_level "L4"
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
if curl -sf -X POST "$BASE/v1/bundles/generate" \
    -F "forms=@/tmp/avni-sdk-synth-forms.xlsx" \
    -F "org=VerifyTest" \
    -D /tmp/avni-sdk-verify-headers.txt \
    -o /tmp/avni-sdk-verify.zip; then
  SIZE=$(ls -l /tmp/avni-sdk-verify.zip | awk '{print $5}')
  if unzip -t /tmp/avni-sdk-verify.zip > /dev/null 2>&1; then
    INTEG="OK"
  else
    INTEG="BAD"
  fi
  # Anchor to start-of-line so Access-Control-Expose-Headers (which mentions
  # X-Bundle-Errors as a substring) doesn't bleed into the match.
  ERRS=$(grep -i "^X-Bundle-Errors:" /tmp/avni-sdk-verify-headers.txt | tr -d '\r' | awk '{print $2}' || echo "")
  # Default ERRS to empty-string if missing; treat missing or non-zero as failure.
  echo "  ZIP=${SIZE}B integrity=$INTEG  validator-errors=${ERRS:-<missing>}"
  if [ "$INTEG" != "OK" ] || [ -z "${SIZE:-}" ] || [ "${SIZE:-0}" -lt 200 ]; then
    fail_level "L5 (bad ZIP)"
  elif [ -z "$ERRS" ]; then
    fail_level "L5 (missing X-Bundle-Errors header)"
  elif [ "$ERRS" != "0" ]; then
    fail_level "L5 (validator-errors=$ERRS, expected 0 on synth fixture)"
  else
    echo "  ✓ L5 passed"
  fi
else
  fail_level "L5 (POST failed)"
fi
echo ""

#─── L6 ─────────────────────────────────────────
echo "═══ L6 — /v1/agent/query ═══"
echo "  401 reject (no key):"
REJECT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/agent/query" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"hi"}')
if [ "$REJECT" = "401" ] || [ "$REJECT" = "403" ]; then
  echo "    ✓ HTTP $REJECT"
else
  echo "    ✗ expected 401/403, got HTTP $REJECT"
  fail_level "L6 (auth check)"
fi
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "  Live agent run (90s timeout, full stream → /tmp/avni-sdk-l6-stream.log):"
  if curl -sN --max-time 90 -X POST "$BASE/v1/agent/query" \
      -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"prompt":"List the 16 avni skills available. For each, give a one-line description. Use the Skill or Read tool — do not answer from memory."}' \
      > /tmp/avni-sdk-l6-stream.log; then
    : # ok — summariser below will pick out any in-stream errors
  else
    fail_level "L6 (curl failed)"
  fi

  # Summarize the stream — count events, show text content, flag issues.
  # Exits non-zero if the stream contained error events or no events at all.
  if ! node - <<'NODE_EOF' /tmp/avni-sdk-l6-stream.log; then
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
    process.exit(1);
  }
  if (events.length === 0) {
    console.log("    ✗ no SSE events parsed — likely transport / auth failure");
    process.exit(1);
  }
  console.log("    ✓ no errors");
NODE_EOF
    fail_level "L6 (stream errors / empty)"
  fi
else
  echo "  (set ANTHROPIC_API_KEY to run a real agent query)"
fi
echo ""

#─── L7 ─────────────────────────────────────────
# Real-LLM regression suite. OPT-IN — gated on TWO env vars so it can never
# accidentally burn tokens in CI. SDK_EVAL_BUDGET_USD is the hard cap the
# harness itself enforces; passing it in here is what arms the level.
echo "═══ L7 — real-LLM eval harness (tests/eval/) ═══"
if [ -z "${ANTHROPIC_API_KEY:-}" ] || [ -z "${SDK_EVAL_BUDGET_USD:-}" ]; then
  echo "  (skipped — set both ANTHROPIC_API_KEY and SDK_EVAL_BUDGET_USD to enable)"
  echo "  Example: SDK_EVAL_BUDGET_USD=5 ANTHROPIC_API_KEY=sk-... bash scripts/verify.sh"
elif [ ! -f "$SDK_DIR/tests/eval/run.cjs" ]; then
  echo "  (skipped — tests/eval/run.cjs not present in this checkout)"
else
  echo "  budget=\$$SDK_EVAL_BUDGET_USD"
  if node tests/eval/run.cjs; then
    echo "  ✓ L7 eval passed"
  else
    fail_level "L7"
  fi
fi

echo ""
if [ "${#FAILED_LEVELS[@]}" -gt 0 ]; then
  echo "═══ FAILED: ${FAILED_LEVELS[*]} ═══" >&2
  exit 1
fi
echo "═══ ALL CHECKS DONE ═══"
