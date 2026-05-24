// Unit tests for src/logging.js — structured NDJSON logger.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Each test loads the module fresh with isolated env so we don't leak level
// state across tests. The module's stream is overridable via _setLogStream so
// we capture writes into a sink and parse them.
async function loadWith(env = {}) {
  const prev = {};
  for (const k of ["SDK_LOG_LEVEL", "SDK_LOG_FORMAT"]) {
    prev[k] = process.env[k];
    if (env[k] !== undefined) process.env[k] = env[k];
    else delete process.env[k];
  }
  // Cache-bust the import so env is re-read on module load.
  const mod = await import("../../src/logging.js?t=" + Date.now() + Math.random());
  const sink = makeSink();
  mod._setLogStream(sink);
  return { mod, sink, restoreEnv: () => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }};
}

function makeSink() {
  const chunks = [];
  return {
    chunks,
    write(s) { chunks.push(s); },
    records() {
      return chunks.join("").split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return { _raw: l }; }
      });
    },
  };
}

test("info-level emits JSON with level/time/msg/fields", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "info" });
  try {
    mod.logger.info({ event: "session.created", sid: "sess_x" }, "session created");
    const recs = sink.records();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].level, 30);
    assert.equal(recs[0].msg, "session created");
    assert.equal(recs[0].event, "session.created");
    assert.equal(recs[0].sid, "sess_x");
    assert.ok(typeof recs[0].time === "number");
  } finally { restoreEnv(); }
});

test("level filtering drops below threshold", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "warn" });
  try {
    mod.logger.trace({}, "t");
    mod.logger.debug({}, "d");
    mod.logger.info({}, "i");
    mod.logger.warn({}, "w");
    mod.logger.error({}, "e");
    const recs = sink.records();
    const msgs = recs.map((r) => r.msg);
    assert.deepEqual(msgs, ["w", "e"]);
  } finally { restoreEnv(); }
});

test("child bindings inherit parent and override on collision", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "trace" });
  try {
    const parent = mod.logger.child({ component: "wallet", sid: "sess_a" });
    const child = parent.child({ sid: "sess_b", turn: 2 }); // sid overridden
    child.info({ event: "spend" }, "recorded");
    const recs = sink.records();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].component, "wallet"); // inherited
    assert.equal(recs[0].sid, "sess_b");        // overridden
    assert.equal(recs[0].turn, 2);              // child-only
    assert.equal(recs[0].event, "spend");
    assert.equal(recs[0].msg, "recorded");
  } finally { restoreEnv(); }
});

test("string-only first arg is treated as message", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "info" });
  try {
    mod.logger.info("just a message");
    const recs = sink.records();
    assert.equal(recs[0].msg, "just a message");
  } finally { restoreEnv(); }
});

test("each emit produces exactly one newline-terminated line", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "info" });
  try {
    mod.logger.info({ a: 1 }, "one");
    mod.logger.info({ b: 2 }, "two");
    mod.logger.info({ c: 3 }, "three");
    const joined = sink.chunks.join("");
    assert.equal(joined.split("\n").filter(Boolean).length, 3);
    assert.ok(joined.endsWith("\n"));
  } finally { restoreEnv(); }
});

test("pretty format produces human-readable single line", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "info", SDK_LOG_FORMAT: "pretty" });
  try {
    mod.logger.warn({ event: "x" }, "warning here");
    const line = sink.chunks.join("");
    assert.match(line, /WARN/);
    assert.match(line, /warning here/);
    assert.ok(line.endsWith("\n"));
  } finally { restoreEnv(); }
});

test("error log includes error field naturally via fields arg", async () => {
  const { mod, sink, restoreEnv } = await loadWith({ SDK_LOG_LEVEL: "info" });
  try {
    mod.logger.error({ event: "validator.fail", error: "boom" }, "validator threw");
    const recs = sink.records();
    assert.equal(recs[0].level, 50);
    assert.equal(recs[0].error, "boom");
    assert.equal(recs[0].event, "validator.fail");
  } finally { restoreEnv(); }
});

test("LEVELS_MAP is exported and correct", async () => {
  const { mod, restoreEnv } = await loadWith();
  try {
    assert.equal(mod.LEVELS_MAP.trace, 10);
    assert.equal(mod.LEVELS_MAP.info, 30);
    assert.equal(mod.LEVELS_MAP.error, 50);
  } finally { restoreEnv(); }
});
