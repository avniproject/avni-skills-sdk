#!/usr/bin/env bash
# demo-full-bundle.sh — drive the SDK agent through a full SRS-to-bundle run.
#
# Usage:
#   export ANTHROPIC_API_KEY='sk-ant-...'    # in your shell only — never paste
#   export AVNI_SKILLS_PATH=~/code/avni-skills
#
#   bash scripts/demo-full-bundle.sh \
#     --forms /path/to/MyOrg-Forms.xlsx \
#     [--modelling /path/to/MyOrg-Modelling.xlsx] \
#     [--org MyOrg] \
#     [--out /tmp/demo-bundle]
#
# What it does:
#   1. Asks /v1/agent/query to drive the full workflow:
#        - Read srs-bundle-generator/SKILL.md
#        - Run the deterministic generator on your SRS
#        - Run the validator on the output
#        - Classify validator errors (mechanical vs F2 semantic)
#        - Report counts + recommended next step
#   2. Streams the SSE events to /tmp/avni-sdk-demo-stream.log
#   3. Prints a structured summary
#
# Output:
#   The generated bundle lands at $OUT (default /tmp/demo-bundle/).
#   You can ZIP it via avni-skills/srs-bundle-generator/scripts/zip_bundle.js,
#   or hit the SDK's /v1/bundles/generate endpoint for a one-shot deterministic ZIP.

set -e

SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

PORT="${PORT:-3030}"
BASE="http://localhost:$PORT"
OUT="/tmp/demo-bundle"
ORG="DemoOrg"
FORMS=""
MODELLING=""

while [ $# -gt 0 ]; do
  case "$1" in
    --forms) FORMS="$2"; shift 2 ;;
    --modelling) MODELLING="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY is not set in your shell." >&2
  echo "  Run:  export ANTHROPIC_API_KEY='sk-ant-...'" >&2
  exit 2
fi
if [ -z "${AVNI_SKILLS_PATH:-}" ]; then
  if [ -d "$SDK_DIR/../avni-skills" ]; then
    export AVNI_SKILLS_PATH="$SDK_DIR/../avni-skills"
  else
    echo "AVNI_SKILLS_PATH not set, ../avni-skills not found." >&2; exit 2
  fi
fi
if [ -z "$FORMS" ] || [ ! -f "$FORMS" ]; then
  echo "--forms <path-to-Forms.xlsx> is required and must exist." >&2; exit 2
fi
if [ -n "$MODELLING" ] && [ ! -f "$MODELLING" ]; then
  echo "--modelling specified but file not found: $MODELLING" >&2; exit 2
fi

# Resolve to absolute paths so the agent's tools can find them
FORMS=$(cd "$(dirname "$FORMS")" && pwd)/$(basename "$FORMS")
[ -n "$MODELLING" ] && MODELLING=$(cd "$(dirname "$MODELLING")" && pwd)/$(basename "$MODELLING")
mkdir -p "$OUT"

# Start the SDK server if it's not already running
if ! curl -sf "$BASE/health" > /dev/null; then
  echo "Starting SDK server on :$PORT..."
  PORT=$PORT node src/server.js > /tmp/avni-sdk-server.log 2>&1 &
  SDK_PID=$!
  trap "kill $SDK_PID 2>/dev/null; wait 2>/dev/null" EXIT
  sleep 2
  if ! curl -sf "$BASE/health" > /dev/null; then
    echo "Server failed to start. Check /tmp/avni-sdk-server.log" >&2; exit 1
  fi
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Full SRS → bundle agent run"
echo "═══════════════════════════════════════════════════════════════"
echo "  Forms:     $FORMS"
[ -n "$MODELLING" ] && echo "  Modelling: $MODELLING"
echo "  Org:       $ORG"
echo "  Output:    $OUT"
echo ""

# Build the prompt — tells the agent the exact workflow + paths.
read -r -d '' PROMPT <<EOF || true
You are doing a full SRS-to-bundle generation for org "$ORG".

Inputs (absolute paths on disk):
  Forms file:     $FORMS
  Modelling file: ${MODELLING:-<not provided>}

Output directory: $OUT

Steps to perform (do them in order, report each one):

1. Read .claude/skills/srs-bundle-generator/SKILL.md to confirm the workflow.

2. Run the deterministic generator. Use Bash:
   node \$AVNI_SKILLS_PATH/srs-bundle-generator/scripts/generate_bundle_v2.js \\
     --forms "$FORMS" \\
$( [ -n "$MODELLING" ] && echo "     --srs \"$MODELLING\" \\\\" )
     --org "$ORG" \\
     --output "$OUT" \\
     --no-validate
   (The env var \$AVNI_SKILLS_PATH is set to the avni-skills repo root.)

3. Run the AVNI server-contract validator on the output. Use Bash with a
   small Node one-liner like:
   node -e 'const {BundleValidator} = require(process.env.AVNI_SKILLS_PATH + "/srs-bundle-generator/validators/bundle_validator"); const r = new BundleValidator("$OUT").validate(); console.log(JSON.stringify({errors: r.errors.length, warnings: r.warnings.length, sample: r.errors.slice(0,5)}))'

4. Classify the errors:
   - F2 errors = "Concept X used twice in form Y" — these are semantic
     (cross-group concept reuse), not generator bugs. They need a domain
     decision (rename per group, RepeatableQuestionGroup, or coded answer set).
   - All other errors = mechanical or SRS-gap issues.

5. Report a concise summary:
   - File counts: concepts, forms, programs, encounter types, subject types
   - Validator totals: errors, warnings
   - Error breakdown by class (F2 vs others)
   - For F2: list the affected forms + how many concept-reuse cases each has
   - For non-F2: list the first 5 with their messages
   - Recommended next step

Keep the answer tight. Use markdown headings. Cite the SKILL.md file when relevant.
EOF

# Pass AVNI_SKILLS_PATH through to the agent's subshells via the prompt itself
# (the SDK doesn't auto-forward env to the spawned process for security reasons).
# Embed it directly:
PROMPT_WITH_ENV=$(echo "$PROMPT" | sed "s|\\\$AVNI_SKILLS_PATH|$AVNI_SKILLS_PATH|g")

echo "Sending prompt to /v1/agent/query (streaming SSE → /tmp/avni-sdk-demo-stream.log)..."
echo ""

# Build the JSON body via Node so the prompt is properly escaped
PAYLOAD=$(PROMPT_BODY="$PROMPT_WITH_ENV" node -e "
  const prompt = process.env.PROMPT_BODY;
  process.stdout.write(JSON.stringify({
    prompt,
    model: process.env.MODEL || 'claude-haiku-4-5-20251001',
    permissionMode: 'bypassPermissions',
  }));
")

curl -sN --max-time 300 -X POST "$BASE/v1/agent/query" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /tmp/avni-sdk-demo-stream.log

echo "═══════════════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════════════"

node - <<'NODE_EOF' /tmp/avni-sdk-demo-stream.log
  const fs = require("node:fs");
  const raw = fs.readFileSync(process.argv[2], "utf8");
  const events = [];
  for (const block of raw.split(/\n\n+/)) {
    const ev = (block.match(/^event: (\S+)/m) || [,null])[1];
    const data = (block.match(/^data: (.*)$/m) || [,null])[1];
    if (ev && data) { try { events.push({ ev, data: JSON.parse(data) }); } catch {} }
  }

  const counts = {};
  for (const e of events) {
    const tag = e.ev === "agent" ? `agent.${e.data.type || "?"}` : e.ev;
    counts[tag] = (counts[tag] || 0) + 1;
  }
  console.log("  events:", events.length, JSON.stringify(counts));

  const toolCalls = events.filter(e => e.ev === "agent" && e.data.type === "assistant")
    .flatMap(e => (e.data.message?.content || []).filter(c => c.type === "tool_use"));
  console.log(`  tool calls: ${toolCalls.length}`);
  for (const tc of toolCalls.slice(0, 12)) {
    const i = JSON.stringify(tc.input).slice(0, 120);
    console.log(`    • ${tc.name} ${i}`);
  }
  if (toolCalls.length > 12) console.log(`    ...(${toolCalls.length - 12} more)`);

  const texts = events.filter(e => e.ev === "agent" && e.data.type === "assistant")
    .flatMap(e => (e.data.message?.content || []).filter(c => c.type === "text").map(c => c.text));
  if (texts.length) {
    console.log("\n  --- agent's final report ---");
    console.log(texts.join("\n").split("\n").map(l => "  " + l).join("\n"));
  } else {
    console.log("  ✗ no assistant text — something went wrong");
  }

  const result = events.find(e => e.ev === "agent" && e.data.type === "result");
  if (result) {
    console.log(`\n  result: stop_reason=${result.data.stop_reason}`);
    if (result.data.usage) {
      const u = result.data.usage;
      console.log(`  tokens: in=${u.input_tokens}  cache_create=${u.cache_creation_input_tokens}  cache_read=${u.cache_read_input_tokens}  out=${u.output_tokens}`);
    }
    if (result.data.total_cost_usd != null) console.log(`  cost: $${result.data.total_cost_usd.toFixed(4)}`);
  }

  const errs = events.filter(e => e.ev === "error");
  if (errs.length) {
    console.log("\n  ✗ errors:");
    errs.forEach(e => console.log(`    ${JSON.stringify(e.data)}`));
  }
NODE_EOF

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Bundle output: $OUT"
ls -la "$OUT" 2>/dev/null | head -15
echo ""
echo "  Full SSE stream: /tmp/avni-sdk-demo-stream.log"
echo "═══════════════════════════════════════════════════════════════"
