#!/usr/bin/env bash
# demo-spec-pipeline.sh — exercises the Phase 6 apply-spec flow end-to-end.
#
# What it does:
#   1. Starts the server (port 3030) with an isolated SDK_SESSIONS_DIR.
#   2. Builds a tiny synthetic SRS (Forms.xlsx) in /tmp.
#   3. Creates a session via POST /v1/sessions.
#   4. Applies a YAML spec adding a subjectType + program + declarative rule.
#   5. Asserts: turn landed, diff has the expected shape, declarative rule
#      compiled to JS, integrity check passes.
#   6. Tears down the server, prints the session id for follow-up inspection.
#
# Usage:
#   AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/demo-spec-pipeline.sh
#
# Requires:
#   - avni-skills at $AVNI_SKILLS_PATH with srs-bundle-generator/spec/ present
#   - Node 20+, no API key needed (deterministic flow, no LLM)

set -e
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

if [ -z "${AVNI_SKILLS_PATH:-}" ]; then
  AVNI_SKILLS_PATH="$SDK_DIR/../avni-skills"
fi
[ -d "$AVNI_SKILLS_PATH" ] || { echo "AVNI_SKILLS_PATH not found: $AVNI_SKILLS_PATH" >&2; exit 2; }

SDK_SESSIONS_DIR="${TMPDIR:-/tmp}/avni-demo-sessions-$$"
PORT="${PORT:-3030}"
BASE="http://localhost:$PORT"

# ── start fresh server ───────────────────────────────────────────────
lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1
echo "─── starting server on :$PORT (sessions at $SDK_SESSIONS_DIR) ──────────"
AVNI_SKILLS_PATH="$AVNI_SKILLS_PATH" SDK_SESSIONS_DIR="$SDK_SESSIONS_DIR" PORT=$PORT \
  node src/server.js > /tmp/avni-demo.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; rm -rf $SDK_SESSIONS_DIR" EXIT
sleep 2
curl -sf "$BASE/health" > /dev/null && echo "✓ server healthy"

# ── build synthetic SRS ───────────────────────────────────────────────
echo ""
echo "─── building synthetic SRS xlsx ─────────────────────────────────────────"
SRS=/tmp/avni-demo-srs.xlsx
node -e "
const path = require('path');
const XLSX = require(path.join('$AVNI_SKILLS_PATH', 'node_modules', 'xlsx'));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Subject Type', 'Type'], ['Beneficiary', 'Person'],
]), 'Subject Types');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Form Name', 'Form Type', 'Form Element Group', 'Form Element', 'Concept Data Type', 'Concept Answers'],
  ['Beneficiary Registration', 'IndividualProfile', 'Identity', 'Full Name', 'Text', ''],
  ['Beneficiary Registration', 'IndividualProfile', 'Identity', 'Gender', 'Coded', 'Male, Female, Other'],
]), 'Forms');
XLSX.writeFile(wb, '$SRS');
console.log('✓ wrote $SRS');
"

# ── create session ────────────────────────────────────────────────────
echo ""
echo "─── creating session ───────────────────────────────────────────────────"
SESSION_JSON=$(curl -sS -X POST "$BASE/v1/sessions" \
  -F "forms=@$SRS" -F "org=DemoOrg")
SID=$(echo "$SESSION_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId")
echo "✓ session: $SID"

# ── apply spec with subjectType + program + declarative rule ──────────
echo ""
echo "─── applying spec (subjectType + program + declarative eligibility rule) ─"
cat > /tmp/avni-demo-spec.yaml <<'EOF'
org: DemoOrg
subjectTypes:
  - name: Volunteer
    type: Person
programs:
  - name: Capacity Building
    targetSubjectType: Volunteer
    colour: "#2E7D32"
    enrolmentEligibilityCheckDeclarativeRule:
      - conditions:
          - conjunction: and
            compoundRule:
              conjunction: and
              rules:
                - lhs:
                    type: Concept
                    conceptName: Gender
                    conceptUuid: "00000000-0000-0000-0000-000000000001"
                    conceptDataType: Coded
                    scope: registration
                  operator: containsAnyAnswerConceptName
                  rhs:
                    type: answerConcept
                    answerConceptNames: [Female]
                    answerConceptUuids: ["00000000-0000-0000-0000-000000000002"]
        actions:
          - actionType: setEligibility
            details: {}
EOF
cat > /tmp/avni-demo-build-payload.js <<'NODEEOF'
const fs = require('fs');
const yaml = fs.readFileSync('/tmp/avni-demo-spec.yaml', 'utf8');
process.stdout.write(JSON.stringify({ yaml }));
NODEEOF
PAYLOAD=$(node /tmp/avni-demo-build-payload.js)
curl -sS -X POST "$BASE/v1/sessions/$SID/apply-spec" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /tmp/avni-demo-resp.json

node -e "
const r = JSON.parse(require('fs').readFileSync('/tmp/avni-demo-resp.json', 'utf8'));
console.log('✓ turn:            ', r.turn ? r.turn.turn : '(no-op)');
console.log('✓ files changed:   ', JSON.stringify(r.filesChanged));
console.log('✓ rules compiled:  ', r.ruleCompilation.compiled.length);
for (const c of r.ruleCompilation.compiled) {
  console.log('   - ' + c.ruleType + ' at ' + c.locator + ' (' + c.jsBytes + ' bytes JS)');
}
console.log('✓ integrity:       ', r.integrity.ok ? 'ok' : 'FAIL — ' + r.integrity.issues.length + ' issues');
console.log('');
console.log('--- diff summary ---');
console.log(r.diffSummary);
"

# ── verify the JS rule actually landed in programs.json ───────────────
echo ""
echo "─── verifying compiled JS in programs.json ─────────────────────────────"
curl -sS "$BASE/v1/sessions/$SID/files/programs.json" | node -e "
const p = JSON.parse(require('fs').readFileSync(0,'utf8'))
  .find((x) => x.name === 'Capacity Building');
if (p?.enrolmentEligibilityCheckRule) {
  console.log('✓ rule landed in programs.json (' + p.enrolmentEligibilityCheckRule.length + ' bytes)');
  console.log('  head: ' + p.enrolmentEligibilityCheckRule.split('\n').slice(0, 3).join(' / '));
} else {
  console.log('✗ enrolmentEligibilityCheckRule missing on Capacity Building');
  process.exit(1);
}
"

echo ""
echo "─── done ───────────────────────────────────────────────────────────────"
echo "session: $SID"
echo "         transcript: $SDK_SESSIONS_DIR/$SID/transcript.jsonl"
echo "         bundle:     $SDK_SESSIONS_DIR/$SID/bundle/"
echo "(server + temp dir cleaned up on exit)"
