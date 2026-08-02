#!/usr/bin/env node
// mcp-stdio.mjs — expose the in-process avni-bundle MCP tools over stdio, so a
// GENERIC MCP client (Claude Code, an IDE, anything speaking the protocol) gets
// the exact same tool set the session agent gets.
//
// WHY
//
// `createBundleMcpServer(bundleCwd)` builds an SDK-flavoured MCP server that the
// Claude Agent SDK consumes IN-PROCESS — it never had a transport, so the tools
// were reachable only from inside a `/v1/sessions/:id/messages` turn. When the
// REPL misbehaves, the tools become unreachable along with it, even though they
// are plain deterministic functions with nothing session-specific about them.
//
// This adds a transport. It does NOT change, wrap, or replace the session path:
// same factory, same frozen tool names (rule §7), same path jails. A session run
// and a stdio run are the same code over the same bundle directory.
//
// USAGE
//
//   node scripts/mcp-stdio.mjs --session sess_xxxxxxxxxxxxxxxx
//   node scripts/mcp-stdio.mjs --bundle /abs/path/to/bundle
//
// or via env (what .mcp.json uses, since MCP clients spawn without argv):
//
//   AVNI_SESSION_ID=sess_xxxx  node scripts/mcp-stdio.mjs
//   AVNI_BUNDLE_CWD=/abs/path  node scripts/mcp-stdio.mjs
//
// A session id is the better choice where you have one: tools that read
// `../meta.json` — bundle_read_srs, bundle_generate_baseline,
// bundle_export_to_path — need a session-backed layout, and a bare bundle dir
// outside a session will make those (and only those) return an actionable error.
//
// STDOUT IS THE PROTOCOL. Nothing may print to it but MCP frames — every
// diagnostic here goes to stderr, or it corrupts the stream.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBundleMcpServer } from "../src/agents/bundle-mcp-server.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

function die(msg) {
  process.stderr.write(`mcp-stdio: ${msg}\n`);
  process.exit(2);
}

const SESSIONS_DIR = process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");

function resolveBundleCwd() {
  const sid = arg("session") || process.env.AVNI_SESSION_ID;
  const bundle = arg("bundle") || process.env.AVNI_BUNDLE_CWD;

  if (sid && bundle) die(`pass --session OR --bundle, not both (got session=${sid} bundle=${bundle})`);

  if (sid) {
    if (!/^sess_[0-9a-f]{16}$/.test(sid)) die(`invalid session id ${JSON.stringify(sid)} (expected sess_<16-hex>)`);
    const dir = path.join(SESSIONS_DIR, sid, "bundle");
    if (!fs.existsSync(dir)) die(`session ${sid} has no bundle dir at ${dir}`);
    return dir;
  }
  if (bundle) {
    const dir = path.resolve(bundle);
    if (!fs.existsSync(dir)) die(`bundle dir does not exist: ${dir}`);
    return dir;
  }
  die(
    "no bundle selected. Pass --session <sess_id> or --bundle <path>, " +
    "or set AVNI_SESSION_ID / AVNI_BUNDLE_CWD.",
  );
}

// avni-skills must resolve for the validator/generator-backed tools. Fail here
// with a clear message rather than letting each tool call fail opaquely later.
if (!process.env.AVNI_SKILLS_PATH) {
  const sibling = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "avni-skills");
  if (fs.existsSync(sibling)) process.env.AVNI_SKILLS_PATH = sibling;
}

const bundleCwd = resolveBundleCwd();

const server = createBundleMcpServer(bundleCwd);
const transport = new StdioServerTransport();
await server.instance.connect(transport);

process.stderr.write(`mcp-stdio: avni-bundle tools bound to ${bundleCwd}\n`);
