#!/usr/bin/env bash
# demo-phase-4.sh — end-to-end proof of agent-driven session edits.
#
# Requires: ANTHROPIC_API_KEY in environment (BYO key).
#
# Walks the full Phase 4 flow:
#   1. Create session from a real SRS (turn 0 = first-pass bundle)
#   2. Send a natural-language instruction to /v1/sessions/:id/messages
#      (Claude reads bundle, runs validator implicitly via Read, computes
#       edits, applies them via Edit/Write — server commits the diff)
#   3. Show the validator delta
#   4. Show the unified diff for turn 1 (the agent's actual changes)
#   5. Run the org-agnostic invariants harness on the post-edit bundle
#   6. Download the final ZIP
#
# Usage:
#   export ANTHROPIC_API_KEY='sk-ant-...'
#   AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/demo-phase-4.sh \
#     --forms /path/to/Forms.xlsx \
#     [--modelling /path/to/Modelling.xlsx] \
#     [--org DemoOrg] \
#     [--prompt "free text instruction to the agent"] \
#     [--model claude-haiku-4-5-20251001]

set -e
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

PORT="${PORT:-3030}"
BASE="http://localhost:$PORT"
ORG="DemoOrg"
FORMS=""
MODELLING=""
PROMPT="Look at the bundle in this workspace. The validator has flagged F2 cross-group concept reuse errors. Pick ONE form that has the same concept referenced twice across different formElementGroups (a real F2 case), remove the duplicate occurrence, and save the file. Make exactly one minimal edit. Do not run git. After saving, briefly explain which form and which concept you removed."
MODEL="${ANTHROPIC_MODEL:-claude-haiku-4-5-20251001}"

while [ $# -gt 0 ]; do
  case "$1" in
    --forms) FORMS="$2"; shift 2 ;;
    --modelling) MODELLING="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -z "${ANTHROPIC_API_KEY:-}" ] && { echo "ANTHROPIC_API_KEY not set" >&2; exit 2; }
[ -z "${AVNI_SKILLS_PATH:-}" ] && { echo "AVNI_SKILLS_PATH not set" >&2; exit 2; }
[ -z "$FORMS" ] || [ ! -f "$FORMS" ] && { echo "--forms required + must exist" >&2; exit 2; }

FORMS=$(cd "$(dirname "$FORMS")" && pwd)/$(basename "$FORMS")
[ -n "$MODELLING" ] && MODELLING=$(cd "$(dirname "$MODELLING")" && pwd)/$(basename "$MODELLING")

if ! curl -sf "$BASE/health" > /dev/null; then
  PORT=$PORT node src/server.js > /tmp/avni-sdk-server.log 2>&1 &
  SDK_PID=$!
  trap "kill $SDK_PID 2>/dev/null; wait 2>/dev/null" EXIT
  sleep 2
fi

show() { echo ""; echo "═══ $* ═══"; }

show "1. Create session from $ORG SRS"
if [ -n "$MODELLING" ]; then
  RESP=$(curl -sf -X POST "$BASE/v1/sessions" -F "forms=@$FORMS" -F "modelling=@$MODELLING" -F "org=$ORG")
else
  RESP=$(curl -sf -X POST "$BASE/v1/sessions" -F "forms=@$FORMS" -F "org=$ORG")
fi
SID=$(echo "$RESP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId")
echo "  sessionId: $SID"
ERR0=$(echo "$RESP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).validation.errors")
echo "  turn 0 validator errors: $ERR0"

show "2. Send natural-language instruction → POST /v1/sessions/:id/messages"
echo "  prompt: $PROMPT"
echo "  model:  $MODEL"
echo "  ─── streaming agent events ───"
LOG=/tmp/avni-sdk-phase4-stream.log
: > "$LOG"
# Pipe SSE stream; show condensed event types in real time, save full log
curl -N -sS -X POST "$BASE/v1/sessions/$SID/messages" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 600 \
  -d "$(node -e "process.stdout.write(JSON.stringify({prompt: process.argv[1], model: process.argv[2]}))" "$PROMPT" "$MODEL")" \
  | tee "$LOG" \
  | node -e "
    let buf=''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)\$/m) || [,''])[1];
        const data = (block.match(/^data:\s*(.*)\$/m) || [,'{}'])[1];
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = {}; }
        if (ev === 'agent') {
          const t = parsed.type || (parsed.subtype || 'unknown');
          let detail = '';
          if (parsed.message?.content) {
            for (const b of parsed.message.content) {
              if (b.type === 'tool_use') detail = '  → tool: ' + b.name + (b.input?.file_path ? ' ' + b.input.file_path.split('/').slice(-2).join('/') : '');
              else if (b.type === 'text' && b.text) detail = '  → ' + b.text.slice(0, 90).replace(/\n+/g, ' ');
            }
          }
          console.log('    [' + t + ']' + detail);
        } else if (ev === 'turn') {
          console.log('  ─── turn committed ───');
          console.log('    turn:  ' + parsed.turn + ' (sha=' + parsed.sha + ')');
          console.log('    files: ' + (parsed.changedFiles || []).join(', '));
          console.log('    validator errors: ' + parsed.validation.errors + '  warnings: ' + parsed.validation.warnings);
        } else if (ev === 'done' || ev === 'start' || ev === 'error') {
          console.log('  [' + ev + '] ' + JSON.stringify(parsed).slice(0, 200));
        }
      }
    });
  "

show "3. Validator delta"
META=$(curl -sf "$BASE/v1/sessions/$SID")
ERR1=$(echo "$META" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).validationAtCurrent.errors")
echo "  turn 0 → turn $(echo "$META" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).currentTurn"): errors $ERR0 → $ERR1"

show "4. Diff for the agent's turn (head)"
curl -sf "$BASE/v1/sessions/$SID/turns/1/diff" 2>/dev/null | head -40 | sed 's/^/  /' || echo "  (no turn 1 — agent made no changes)"

show "5. Org-agnostic invariants harness"
SESSION_BUNDLE=$(node -e "
  const path = require('node:path');
  const os = require('node:os');
  console.log(path.join(os.tmpdir(), 'avni-sdk-sessions', '$SID', 'bundle'));
")
node tests/bundle-harness.cjs "$SESSION_BUNDLE" 2>/dev/null | tail -25 | sed 's/^/  /'

show "6. Final ZIP"
ZIP_PATH="/tmp/avni-sdk-phase4-${ORG}.zip"
curl -sf "$BASE/v1/sessions/$SID/zip" -o "$ZIP_PATH"
echo "  $ZIP_PATH ($(ls -lh "$ZIP_PATH" | awk '{print $5}'))"
unzip -t "$ZIP_PATH" 2>&1 | tail -1 | sed 's/^/  /'

echo ""
echo "═══ PHASE 4 END-TO-END ✓ ═══"
echo "  session_id: $SID"
echo "  errors:     $ERR0 → $ERR1"
echo "  zip:        $ZIP_PATH"
echo "  full SSE log: $LOG"
echo "  cleanup:    curl -X DELETE $BASE/v1/sessions/$SID"
