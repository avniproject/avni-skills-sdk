// Org registry for the corpus regression runner.
//
// Maps an org name (the bundle directory's basename under SDK_CORPUS_PATH)
// to its YAML spec filename (under <CORPUS>/specs/). The mapping is not
// 1:1 — directory names have spaces ("Calcutta Kids/"), spec files use
// underscores ("Calcutta_Kids.yaml"). Some directories have no spec; some
// specs have no directory. We expose both, the runner checks per-org.
//
// CLAUDE.md §2: the corpus is NEVER committed to the repo. SDK_CORPUS_PATH
// points at a local directory outside the repo. The registry encodes the
// mapping, not the data.

const fs = require("node:fs");
const path = require("node:path");

function corpusRoot() {
  return process.env.SDK_CORPUS_PATH || path.resolve(
    "/Users/samanvay/Downloads/All/orgs-bundle",
  );
}

function bundleDirs() {
  const root = corpusRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "specs" && !e.name.startsWith("."))
    .map((e) => ({
      org: e.name,
      bundleDir: path.join(root, e.name),
    }));
}

function specsRoot() {
  return path.join(corpusRoot(), "specs");
}

function findSpecYaml(orgName) {
  // Spec files replace " " with "_" (Calcutta_Kids.yaml for "Calcutta Kids").
  // A few specs have no matching bundle dir (Uninhibited.yaml); a few bundles
  // have no spec (specs/ doesn't list them). Return null when missing.
  const root = specsRoot();
  if (!fs.existsSync(root)) return null;
  const candidate = path.join(root, orgName.replace(/ /g, "_") + ".yaml");
  if (fs.existsSync(candidate)) return candidate;
  // Fall back: try exact match
  const exact = path.join(root, orgName + ".yaml");
  if (fs.existsSync(exact)) return exact;
  return null;
}

function listOrgs() {
  return bundleDirs().map(({ org, bundleDir }) => ({
    org,
    bundleDir,
    specPath: findSpecYaml(org),
  }));
}

module.exports = { corpusRoot, bundleDirs, specsRoot, findSpecYaml, listOrgs };
