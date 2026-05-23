// commands/workflows.mjs — deterministic spec-based workflows:
//   :apply <spec.yaml>  parse YAML → materialise declarative rules →
//                       patch the bundle → commit as a turn.

import fs from "node:fs";
import path from "node:path";
import { cyan, dim, green, red, yellow } from "../ui.mjs";

export function makeWorkflowsCommands({ http }) {
  const { postJson } = http;

  async function cmdApply(sid, fileArg) {
    if (!fileArg) {
      console.log(red("  usage: :apply <path-to-spec.yaml>"));
      return;
    }
    const fp = path.resolve(fileArg);
    if (!fs.existsSync(fp)) {
      console.log(red("  file not found: " + fp));
      return;
    }
    const yamlStr = fs.readFileSync(fp, "utf8");
    let res;
    try {
      res = await postJson(`/v1/sessions/${sid}/apply-spec`, { yaml: yamlStr });
    } catch (e) {
      console.log(red("  apply-spec failed: " + (e.message || e)));
      return;
    }
    // Render
    if (res.turn) {
      console.log(green("  ✓") + " turn " + cyan(String(res.turn.turn)) +
                  " · sha=" + dim(res.turn.sha) +
                  " · " + res.filesChanged.length + " files changed");
    } else {
      console.log(dim("  (no-op — spec produced no changes)"));
    }
    if (res.diffSummary) {
      console.log(dim("  diff:"));
      console.log(res.diffSummary);
    }
    if (res.ruleCompilation?.compiled?.length) {
      console.log(dim("  rules materialised:"));
      for (const c of res.ruleCompilation.compiled) {
        console.log("    " + green("✓") + " " + c.ruleType + " · " + dim(c.locator) + " (" + c.jsBytes + " bytes)");
      }
    }
    if (res.ruleCompilation?.errors?.length) {
      console.log(red("  rule compilation errors:"));
      for (const e of res.ruleCompilation.errors) {
        console.log("    " + red("✗") + " " + e.locator + ": " + e.error);
      }
    }
    if (!res.integrity?.ok) {
      console.log(red("  ✗ integrity check failed (" + res.integrity.issues.length + " issue(s)):"));
      for (const i of res.integrity.issues.slice(0, 8)) {
        const icon = i.severity === "error" ? red("✗") : yellow("!");
        console.log("    " + icon + " " + i.message);
      }
      if (res.integrity.issues.length > 8) console.log(dim("    … " + (res.integrity.issues.length - 8) + " more"));
    } else {
      console.log(dim("  integrity: ✓ no dangling references"));
    }
  }

  return { cmdApply };
}
