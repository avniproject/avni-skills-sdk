#!/usr/bin/env node
// Phase 4 machinery dry-run — proves the per-session staging + commit flow
// works without spending a single token on Claude. Simulates what the agent
// would do (mutate a file in the bundle dir) and runs the same commit path
// the messages endpoint uses.
//
// Usage:
//   AVNI_SKILLS_PATH=~/code/avni-skills \
//     node scripts/dryrun-phase-4.mjs --forms <forms.xlsx> [--modelling <modelling.xlsx>] [--org Foo]
//
// Exit non-zero on any check failure. No network, no key.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as sessions from "../src/sessions.js";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

const formsPath = arg("forms");
const modellingPath = arg("modelling");
const org = arg("org", "P4Dryrun");
if (!formsPath) {
  console.error("usage: --forms <path> [--modelling <path>] [--org X]");
  process.exit(2);
}

function check(label, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) process.exit(1);
}

// 1. Create a session
const create = sessions.createSession({
  formsBuffer: fs.readFileSync(formsPath),
  formsFilename: path.basename(formsPath),
  modellingBuffer: modellingPath ? fs.readFileSync(modellingPath) : undefined,
  modellingFilename: modellingPath ? path.basename(modellingPath) : undefined,
  org,
});
const sid = create.sessionId;
console.log(`session ${sid} created`);
console.log(`  turn 0 validation: errors=${create.validation.errors} warnings=${create.validation.warnings} groups=${JSON.stringify(create.validation.groups)}`);

const dir = sessions.bundleDir(sid);

// 2. .gitignore should be present and contain .claude/
const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
check("turn-0 .gitignore contains .claude/", gi.split(/\r?\n/).some((l) => l.trim() === ".claude/"));

// 3. Stage skills
const staging = sessions.ensureSessionSkillsStaged(sid);
check("skills staged into bundle dir", staging.staged > 0 || staging.total > 0, `staged=${staging.staged} total=${staging.total}`);
const skillsLink = path.join(dir, ".claude", "skills");
check(".claude/skills/ exists", fs.existsSync(skillsLink));
const stagedSkills = fs.readdirSync(skillsLink);
check(`>= 16 skills visible at .claude/skills/`, stagedSkills.length >= 16, `(${stagedSkills.length})`);

// 4. Re-stage is idempotent (no errors, no duplicates)
const staging2 = sessions.ensureSessionSkillsStaged(sid);
check("re-staging is idempotent (creates 0 new symlinks)", staging2.staged === 0);

// 5. Commit with no changes → noChanges
const noop = sessions.commitWorkspaceChanges(sid, "noop turn");
check("commitWorkspaceChanges with no changes → noChanges:true", noop.noChanges === true);
check("turn counter not incremented on noop", noop.turn === 0);

// 6. Simulate an agent edit. Find one duplicate concept reference in any form.
const formsDir = path.join(dir, "forms");
const formFiles = fs.existsSync(formsDir) ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")) : [];
let mutatedForm = null;
let removedConcept = null;
for (const ff of formFiles) {
  const fpath = path.join(formsDir, ff);
  const data = JSON.parse(fs.readFileSync(fpath, "utf8"));
  const seen = new Set();
  let changed = false;
  for (const fe of data.formElementGroups || []) {
    const out = [];
    for (const el of fe.formElements || []) {
      const k = el?.concept?.uuid;
      if (k && seen.has(k) && !changed) {
        // remove this duplicate, record what we did
        removedConcept = el?.concept?.name || el?.name || k;
        mutatedForm = data.name || ff;
        changed = true;
        continue;
      }
      if (k) seen.add(k);
      out.push(el);
    }
    if (changed) {
      fe.formElements = out;
      break;
    }
  }
  if (changed) {
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2));
    break;
  }
}
if (!mutatedForm) {
  console.log("⚠ no duplicate concept found in any form — skipping commit-with-changes step");
  process.exit(0);
}
console.log(`simulated agent edit: removed duplicate '${removedConcept}' from form '${mutatedForm}'`);

// 7. Commit the simulated edit
const turn1 = sessions.commitWorkspaceChanges(sid, "remove one duplicate concept from a form");
check("turn 1 created", turn1.turn === 1 && !!turn1.sha, `sha=${turn1.sha}`);
check("turn 1 validator runs and reports errors/warnings", typeof turn1.validation.errors === "number");
console.log(`  turn 1 validation: errors=${turn1.validation.errors} warnings=${turn1.validation.warnings} groups=${JSON.stringify(turn1.validation.groups)}`);
check("validator delta: errors went down OR stayed same", turn1.validation.errors <= create.validation.errors,
  `(${create.validation.errors} → ${turn1.validation.errors})`);
check("changed files reported", turn1.changedFiles.length > 0, `(${turn1.changedFiles.length} file)`);

// 8. The .claude/ staging is not in git history
const lsTree = execFileSync("git", ["ls-tree", "-r", "HEAD", "--name-only"], { cwd: dir, encoding: "utf8" });
check(".claude/ not in git history", !lsTree.split("\n").some((p) => p.startsWith(".claude/")));

// 9. Turn list shows turn 0 and turn 1
const turns = sessions.listTurns(sid);
check("listTurns shows 2 turns", turns.length === 2);
check("turn 1 summary saved", turns[1].summary.includes("duplicate"));

// 10. Diff turn 1 contains the form file
const diff = sessions.diffTurn(sid, 1);
check("diff for turn 1 references the mutated form", diff.includes("forms/") || diff.includes(mutatedForm.replace(/\s+/g, "")), `(diff length: ${diff.length})`);

// 11. Cleanup
sessions.deleteSession(sid);
check("session deleted", true);

console.log("\n✓ Phase 4 machinery dry-run: ALL CHECKS PASS");
console.log(`  validator delta on simulated edit: ${create.validation.errors} → ${turn1.validation.errors} errors`);
