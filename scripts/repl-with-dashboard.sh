#!/usr/bin/env bash
# repl-with-dashboard.sh — launch the REPL + observability dashboard
# side-by-side. Uses tmux when available; degrades to clear instructions
# when not.
#
# Pass the same args you'd pass to `npm run cli` — they're forwarded.
#   bash scripts/repl-with-dashboard.sh --demo
#   bash scripts/repl-with-dashboard.sh --resume sess_xxxxxxxxxxxxxxxx
#   bash scripts/repl-with-dashboard.sh --forms ./MyOrg-Forms.xlsx --org MyOrg

set -e
SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SDK_DIR"

# ── Resolve AVNI_SKILLS_PATH if the user hasn't set it ──────────────
if [ -z "${AVNI_SKILLS_PATH:-}" ]; then
  if [ -d "$SDK_DIR/../avni-skills" ]; then
    export AVNI_SKILLS_PATH="$SDK_DIR/../avni-skills"
  else
    echo "AVNI_SKILLS_PATH not set, and ../avni-skills not found." >&2
    exit 2
  fi
fi

# ── tmux present? ────────────────────────────────────────────────────
TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
if [ -z "$TMUX_BIN" ]; then
  for candidate in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do
    [ -x "$candidate" ] && TMUX_BIN="$candidate" && break
  done
fi

if [ -z "$TMUX_BIN" ]; then
  echo "─────────────────────────────────────────────────────────────────────────"
  echo "  tmux not found — falling back to single-pane mode."
  echo ""
  echo "  Side-by-side observability needs tmux. Install it via:"
  echo "    brew install tmux            # macOS"
  echo "    sudo apt install tmux        # Debian/Ubuntu"
  echo ""
  echo "  In the meantime, you can:"
  echo "    1. Run the REPL in this terminal:  npm run cli -- $*"
  echo "    2. In a SECOND terminal, run:"
  echo "         npm run dashboard -- --session <sid-printed-by-the-repl>"
  echo "─────────────────────────────────────────────────────────────────────────"
  echo ""
  echo "Starting the REPL now in single-pane mode…"
  exec npm run cli -- "$@"
fi

# ── tmux IS available — spawn a 60/40 split ─────────────────────────
SESSION_NAME="avni-sdk-$$"
# Left pane: the REPL (60% width)
# Right pane: a placeholder that waits for the user to set the session id;
# the user runs `:state` in the REPL to copy the sid, then `tmux send-keys`
# isn't a clean UX here. Easier: the right pane shows a hint, the user
# pastes the sid manually after creating the session.
#
# Better: the right pane starts the dashboard automatically with --session
# polling by reading the latest meta.json from the default sessions dir.
# We give it a small bootstrap loop that waits up to 30s for a fresh
# session to appear, then auto-attaches.

# Build the right-pane command. It polls ~/.avni-skills-sdk/sessions/ for the
# newest session created in the last 60s, then launches the dashboard.
RIGHT_CMD=$(cat <<'BASH'
SDK_SESSIONS_DIR="${SDK_SESSIONS_DIR:-$HOME/.avni-skills-sdk/sessions}"
echo "Waiting for a new session in $SDK_SESSIONS_DIR ..."
for i in $(seq 1 60); do
  if [ -d "$SDK_SESSIONS_DIR" ]; then
    LATEST=$(ls -t "$SDK_SESSIONS_DIR" 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      # Only attach if the session is very fresh (< 60s)
      META="$SDK_SESSIONS_DIR/$LATEST/meta.json"
      if [ -f "$META" ]; then
        AGE=$(($(date +%s) - $(stat -f %m "$META" 2>/dev/null || stat -c %Y "$META")))
        if [ "$AGE" -lt 60 ]; then
          echo "Attaching dashboard to $LATEST (age ${AGE}s)…"
          exec npm run dashboard -- --session "$LATEST"
        fi
      fi
    fi
  fi
  sleep 1
done
echo "No fresh session detected in 60s. Start the REPL in the left pane."
echo "Press Enter to retry, or Ctrl-C to exit."
read -r
exec npm run dashboard -- --session $(ls -t "$SDK_SESSIONS_DIR" | head -1)
BASH
)

# Forward all CLI args to the left pane — re-quote each arg with printf %q
# so quoted args containing spaces (--forms "Durga India.xlsx", --org "Durga
# India") survive the `tmux new-session "$LEFT_CMD"` round-trip. Without
# this, `$*` joins on bare space and the receiving npm sees the path tokens
# as positional args; REPL silently errors out and the right-pane dashboard
# polls a dead server forever.
LEFT_ARGS=""
for a in "$@"; do
  LEFT_ARGS+=" $(printf '%q' "$a")"
done
LEFT_CMD="cd $(printf '%q' "$SDK_DIR") && AVNI_SKILLS_PATH=$(printf '%q' "$AVNI_SKILLS_PATH") npm run cli --${LEFT_ARGS}"

"$TMUX_BIN" new-session -d -s "$SESSION_NAME" -x 220 -y 50 "$LEFT_CMD"

# Scrollback ergonomics — without these, mouse wheel does nothing and
# tmux's per-pane scrollback is capped at 2000 lines (a single long demo
# easily blows past that). `mouse on` lets the wheel scroll without
# entering copy-mode first; `history-limit 50000` keeps ~50k lines of
# REPL/dashboard output per pane.
#
# Manual fallback (works without these too): Ctrl-b [ enters copy-mode,
# PgUp/PgDn/arrows to scroll, q to exit.
"$TMUX_BIN" set-option -t "$SESSION_NAME" -g mouse on
"$TMUX_BIN" set-option -t "$SESSION_NAME" -g history-limit 50000

"$TMUX_BIN" split-window -h -t "$SESSION_NAME" -p 40 \
  "cd $(printf '%q' "$SDK_DIR") && AVNI_SKILLS_PATH=$(printf '%q' "$AVNI_SKILLS_PATH") bash -c $(printf '%q' "$RIGHT_CMD")"
"$TMUX_BIN" select-pane -t "$SESSION_NAME":0.0
"$TMUX_BIN" attach-session -t "$SESSION_NAME"
