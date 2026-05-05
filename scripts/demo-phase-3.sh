#!/usr/bin/env bash
# demo-phase-3.sh — end-to-end proof of the iterative-editing session API.
#
# No Anthropic key required. Walks the session lifecycle:
#   1. Create session from a real SRS (turn 0 = first-pass bundle)
#   2. Inspect state — file tree, validator summary
#   3. Apply a real edit via /v1/sessions/:id/edit (Wizard-of-Oz, no LLM):
#        remove one duplicate form-element from the Draft form,
#        which fixes one of the F2 cross-group reuse errors
#   4. Re-validate — error count should drop by 1
#   5. Show the unified diff
#   6. Revert to turn 0 — error count should bounce back
#   7. Re-apply the edit (turn 2)
#   8. Generate the final ZIP
#
# Output:
#   /tmp/avni-sdk-phase3-demo/        bundle workspace
#   ${ZIP_PATH}                       packaged ZIP
#
# Usage:
#   AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/demo-phase-3.sh \
#     --forms /path/to/Forms.xlsx \
#     [--modelling /path/to/Modelling.xlsx] \
#     [--org DemoOrg]

set -e
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

PORT="${PORT:-3030}"
BASE="http://localhost:$PORT"
ORG="DemoOrg"
FORMS=""
MODELLING=""

while [ $# -gt 0 ]; do
  case "$1" in
    --forms) FORMS="$2"; shift 2 ;;
    --modelling) MODELLING="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -z "${AVNI_SKILLS_PATH:-}" ] && { echo "AVNI_SKILLS_PATH not set" >&2; exit 2; }
[ -z "$FORMS" ] || [ ! -f "$FORMS" ] && { echo "--forms required + must exist" >&2; exit 2; }

# Resolve to absolute paths
FORMS=$(cd "$(dirname "$FORMS")" && pwd)/$(basename "$FORMS")
[ -n "$MODELLING" ] && MODELLING=$(cd "$(dirname "$MODELLING")" && pwd)/$(basename "$MODELLING")

# Start server if not running
if ! curl -sf "$BASE/health" > /dev/null; then
  PORT=$PORT node src/server.js > /tmp/avni-sdk-server.log 2>&1 &
  SDK_PID=$!
  trap "kill $SDK_PID 2>/dev/null; wait 2>/dev/null" EXIT
  sleep 2
fi

show() { echo ""; echo "═══ $* ═══"; }

show "1. Create session from $ORG SRS"
SESSION_RESPONSE=$(
  if [ -n "$MODELLING" ]; then
    curl -sf -X POST "$BASE/v1/sessions" \
      -F "forms=@$FORMS" -F "modelling=@$MODELLING" -F "org=$ORG"
  else
    curl -sf -X POST "$BASE/v1/sessions" -F "forms=@$FORMS" -F "org=$ORG"
  fi
)
SID=$(echo "$SESSION_RESPONSE" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId")
echo "  sessionId: $SID"
echo "$SESSION_RESPONSE" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const v = r.validation;
  console.log('  turn 0 validator: errors=' + v.errors + '  warnings=' + v.warnings + '  groups=' + JSON.stringify(v.groups));
"

show "2. Inspect state — file tree (head)"
curl -sf "$BASE/v1/sessions/$SID" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('  org: ' + r.org + '  currentTurn: ' + r.currentTurn);
  console.log('  files: ' + r.files.length);
  for (const f of r.files.slice(0, 8)) console.log('    ' + f);
  console.log('    ... (' + (r.files.length - 8) + ' more)');
"

show "3. Build a meaningful edit — remove one duplicate F2 reference from a form"
# Find the first form that has a duplicate concept reference (an F2 error),
# and propose removing one of the duplicates. This is a real semantic fix.
EDIT_PAYLOAD=$(node - "$BASE" "$SID" <<'NODE_EOF'
const http = require("node:http");
const [, , base, sid] = process.argv;

function get(path) {
  return new Promise((res, rej) => {
    http.get(base + path, (r) => {
      let body = ""; r.on("data", c => body += c); r.on("end", () => res(body));
    }).on("error", rej);
  });
}

(async () => {
  const meta = JSON.parse(await get(`/v1/sessions/${sid}`));
  const formFiles = meta.files.filter(f => f.startsWith("forms/") && !f.includes("Cancellation"));

  // Find first form with a duplicate concept UUID across groups
  for (const ff of formFiles) {
    const text = await get(`/v1/sessions/${sid}/files/${ff}`);
    const f = JSON.parse(text);
    const seen = new Map();   // uuid → first { groupIndex, elementIndex }
    let dupGroupIdx = -1, dupElIdx = -1, dupConceptName = null;
    outer: for (let gi = 0; gi < (f.formElementGroups || []).length; gi++) {
      const g = f.formElementGroups[gi];
      for (let ei = 0; ei < (g.formElements || []).length; ei++) {
        const el = g.formElements[ei];
        const u = el.concept?.uuid;
        if (!u) continue;
        if (seen.has(u)) {
          dupGroupIdx = gi; dupElIdx = ei; dupConceptName = el.concept.name;
          break outer;
        }
        seen.set(u, { gi, ei });
      }
    }
    if (dupGroupIdx >= 0) {
      // Remove the duplicate (the second occurrence)
      f.formElementGroups[dupGroupIdx].formElements.splice(dupElIdx, 1);
      const payload = {
        summary: `remove duplicate '${dupConceptName}' from form '${f.name}' (fixes one F2 error)`,
        edits: { [ff]: JSON.stringify(f, null, 2) },
      };
      process.stdout.write(JSON.stringify(payload));
      return;
    }
  }
  // No duplicates found — emit a no-op edit so the demo still progresses
  process.stdout.write(JSON.stringify({
    summary: "no F2 duplicates to fix — demo no-op edit",
    edits: {},
  }));
})();
NODE_EOF
)

EDIT_SUMMARY=$(echo "$EDIT_PAYLOAD" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).summary")
echo "  edit: $EDIT_SUMMARY"

show "4. Apply the edit (POST /v1/sessions/:id/edit) — turn 1"
TURN1=$(curl -sf -X POST "$BASE/v1/sessions/$SID/edit" \
  -H "Content-Type: application/json" \
  -d "$EDIT_PAYLOAD")
echo "$TURN1" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('  turn ' + r.turn + ' (sha=' + r.sha + '): ' + r.summary);
  console.log('  validator: errors=' + r.validation.errors + '  warnings=' + r.validation.warnings + '  groups=' + JSON.stringify(r.validation.groups));
"

show "5. Diff for turn 1"
curl -sf "$BASE/v1/sessions/$SID/turns/1/diff" | head -25 | sed 's/^/  /'
echo "  ..."

show "6. List turns"
curl -sf "$BASE/v1/sessions/$SID/turns" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  for (const t of r.turns) console.log('  turn ' + t.turn + '  ' + t.sha + '  ' + t.summary);
"

show "7. Revert to turn 0"
REVERTED=$(curl -sf -X POST "$BASE/v1/sessions/$SID/revert" \
  -H "Content-Type: application/json" \
  -d '{"to_turn": 0}')
echo "$REVERTED" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('  currentTurn=' + r.currentTurn + '  errors=' + r.validationAtCurrent.errors + ' (back to first-pass)');
"

show "8. Run org-agnostic invariants harness on the post-edit bundle"
# Grab the session's bundle directory directly for the harness
SESSION_BUNDLE=$(node -e "
  const path = require('node:path');
  const os = require('node:os');
  console.log(path.join(os.tmpdir(), 'avni-sdk-sessions', '$SID', 'bundle'));
")
node tests/bundle-harness.cjs "$SESSION_BUNDLE" 2>/dev/null | tail -25 | sed 's/^/  /'

show "9. Re-apply the edit (turn 1 again, now turn 1 because we reverted)"
TURN_REDO=$(curl -sf -X POST "$BASE/v1/sessions/$SID/edit" \
  -H "Content-Type: application/json" \
  -d "$EDIT_PAYLOAD")
echo "$TURN_REDO" | node -e "
  const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('  turn ' + r.turn + ': ' + r.summary);
  console.log('  validator: errors=' + r.validation.errors);
"

show "10. Download the final ZIP"
ZIP_PATH="/tmp/avni-sdk-phase3-${ORG}.zip"
curl -sf "$BASE/v1/sessions/$SID/zip" -o "$ZIP_PATH"
echo "  $ZIP_PATH ($(ls -lh "$ZIP_PATH" | awk '{print $5}'))"
unzip -t "$ZIP_PATH" 2>&1 | tail -1 | sed 's/^/  /'

echo ""
echo "═══ PHASE 3 END-TO-END ✓ ═══"
echo "  session_id:  $SID"
echo "  zip:         $ZIP_PATH"
echo "  cleanup:     curl -X DELETE $BASE/v1/sessions/$SID"
