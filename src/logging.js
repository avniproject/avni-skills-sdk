// Structured logger — dep-free, NDJSON to stderr.
//
// Drop-in replacement for the ad-hoc `console.warn` / `console.error` calls
// scattered through the codebase. Do NOT actually replace those callsites in
// this PR (other agents are touching them in parallel); this module exists so
// the integrator can swap them in cleanly.
//
// API:
//   logger.trace({ event, ... }, "message")
//   logger.debug(...)
//   logger.info(...)
//   logger.warn(...)
//   logger.error(...)
//   logger.child(bindings) → returns a logger whose every emit inherits
//                            `bindings` (child-level fields override parent).
//
// Levels: trace=10 / debug=20 / info=30 / warn=40 / error=50.
// Anything below SDK_LOG_LEVEL (default info) is dropped before serialisation.
//
// SDK_LOG_FORMAT:
//   "json" (default) — one NDJSON object per line, ms timestamp.
//   "pretty"         — single-line human-readable; use in dev only. No colour
//                       (avoids a chalk dep and stays terminal-agnostic).
//
// Output goes to stderr by default so it doesn't mix with stdout responses
// (server responds on stdout via Express; logs are sidechannel). Tests can
// override via `_setLogStream`.

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const LEVEL_NAMES = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error" };

function resolveLevel() {
  const raw = (process.env.SDK_LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function resolveFormat() {
  const raw = (process.env.SDK_LOG_FORMAT || "json").toLowerCase();
  return raw === "pretty" ? "pretty" : "json";
}

// Mutable so tests can swap. Re-read each emit so changes to env take effect
// in long-running test sequences.
let stream = process.stderr;

export function _setLogStream(s) {
  stream = s;
}

function serialise(rec, format) {
  if (format === "pretty") {
    const { level, time, msg, ...rest } = rec;
    const lvl = (LEVEL_NAMES[level] || String(level)).toUpperCase().padEnd(5);
    const ts = new Date(time).toISOString();
    const tail = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
    return `${ts} ${lvl} ${msg || ""}${tail}\n`;
  }
  return JSON.stringify(rec) + "\n";
}

function emit(levelNum, bindings, fieldsOrMsg, maybeMsg) {
  if (levelNum < resolveLevel()) return;
  let fields, msg;
  if (typeof fieldsOrMsg === "string") {
    fields = {};
    msg = fieldsOrMsg;
  } else {
    fields = fieldsOrMsg || {};
    msg = maybeMsg;
  }
  const rec = {
    level: levelNum,
    time: Date.now(),
    ...bindings,
    ...fields,
  };
  if (msg !== undefined) rec.msg = msg;
  stream.write(serialise(rec, resolveFormat()));
}

function makeLogger(bindings) {
  return {
    trace: (f, m) => emit(LEVELS.trace, bindings, f, m),
    debug: (f, m) => emit(LEVELS.debug, bindings, f, m),
    info:  (f, m) => emit(LEVELS.info,  bindings, f, m),
    warn:  (f, m) => emit(LEVELS.warn,  bindings, f, m),
    error: (f, m) => emit(LEVELS.error, bindings, f, m),
    child(childBindings) {
      // Child fields override parent fields on collision (standard pino-style
      // semantics). The merge happens here, not per emit, so we pay it once.
      return makeLogger({ ...bindings, ...(childBindings || {}) });
    },
  };
}

export const logger = makeLogger({});
export const LEVELS_MAP = LEVELS;
