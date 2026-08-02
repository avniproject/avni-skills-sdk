// src/spec-view/sync.js — Live Spec View spec-sync step (contract §2.3, P3).
//
// Pure filesystem + emit. NO git, NO gate — the caller
// (src/sessions.js commitWorkspaceChanges) owns the commit + reviewSpec call so
// that ordering stays in exactly one place (mirroring how the CRL gate keeps
// its commit/gate ownership in the session layer, not in its emitters).
//
// NEVER throws: a genuine infra-level failure (e.g. an unresolvable brain path,
// or a malformed bundle whose `forms` entry is not a directory) degrades to
// { specChanged:false, identityChanged:false, error }, matching the fail-safe
// stance every other CRL wrapper in this codebase already takes
// (runCrlGateSafely, runSpecGateSafely, summariseIntegrity).
//
// Per-file bundle corruption is a DIFFERENT, lower-severity case handled
// upstream (synthesis M8): readRichBundleFileMap (P1) swallows a single
// unreadable/corrupt file and treats that family as absent, so emitRichSpec
// still returns a valid (thin) spec rather than throwing — this try/catch
// exists for the infra-level failure class, not per-file JSON corruption.
//
// `disabled` is deliberately NOT set here — the CALLER owns the SDK_SPEC_VIEW
// flag and stamps `disabled` on the result it returns when the step is skipped
// (contract §2.3 / §2.4).
import fs from "node:fs";
import path from "node:path";
import { emitRichSpec } from "./emit.js";
import { emitIdentityMap } from "./identity-map.js";

const SPEC_REL_PATH = "spec.yaml";
const IDENTITY_REL_PATH = "identity-map.yaml";

/**
 * Emit spec.yaml + identity-map.yaml from the bundle at `bundleDir` and write
 * them into the bundle root, ONLY when content actually changed (byte
 * comparison against what's currently on disk) — this is what keeps a re-emit
 * of an unchanged bundle a true no-op: no spurious git diff, no spurious
 * commit, no spurious reviewSpec call.
 *
 * BOTH artifacts are emitted BEFORE either is written, so a throw from either
 * emitter leaves NO partial file on disk (the true-degrade contract).
 *
 * @param {string} bundleDir
 * @param {{org?: string}} [opts]
 * @returns {{specChanged: boolean, identityChanged: boolean, specRelPath: string, identityRelPath: string, error?: string}}
 */
export function syncSpecView(bundleDir, { org = "" } = {}) {
  const specPath = path.join(bundleDir, SPEC_REL_PATH);
  const identityPath = path.join(bundleDir, IDENTITY_REL_PATH);
  try {
    const specYaml = emitRichSpec({ bundleDir, org });
    const { yaml: identityYaml } = emitIdentityMap({ bundleDir });

    const prevSpec = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : null;
    const prevIdentity = fs.existsSync(identityPath) ? fs.readFileSync(identityPath, "utf8") : null;

    const specChanged = prevSpec !== specYaml;
    const identityChanged = prevIdentity !== identityYaml;

    if (specChanged) fs.writeFileSync(specPath, specYaml);
    if (identityChanged) fs.writeFileSync(identityPath, identityYaml);

    return { specChanged, identityChanged, specRelPath: SPEC_REL_PATH, identityRelPath: IDENTITY_REL_PATH };
  } catch (e) {
    return { specChanged: false, identityChanged: false, specRelPath: SPEC_REL_PATH, identityRelPath: IDENTITY_REL_PATH, error: e.message };
  }
}
