// Layer 4 — static validator for AVNI rule bodies.
//
// Inputs: a rule body string (the JS that lives inside a bundle JSON's
// decisionRule / visitScheduleRule / etc. field), plus a concepts.json from
// the same bundle.
//
// What we check (no runtime, fast):
//   1. PARSE — acorn parses as ES2020. Reject syntax errors.
//   2. WRAPPER — top form must be one of the two accepted shapes:
//        - "use strict"; ({params, imports}) => { ... }
//        - "use strict"; function (params, imports) { ... }
//      Both are seen in production bundles.
//   3. IDENTIFIERS — every free identifier referenced from the body must be
//      either a JS standard global, `params`, `imports`, or a local binding.
//      Reject `require`, `process`, `global`, `globalThis`, `eval`,
//      `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `import`.
//   4. IMPORT PATHS — `imports.X` member access is whitelisted:
//      rulesConfig | common | lodash | moment | motherCalculations | log |
//      models. (No `imports.globalFn` — the rules-server does not inject it.)
//   5. rulesConfig CLASSES — `imports.rulesConfig.X` must be one of the
//      classes exported from rules-config/rules.js.
//   6. CONCEPT UUIDS — every string literal matching a UUID shape that
//      *looks* like a concept reference must be found in concepts.json.
//      (Misses dynamic UUID assembly, but those are rare and noisy anyway.)
//
// What we do NOT check:
//   - Runtime correctness (rules can still throw at eval time).
//   - Subject UUIDs, encounter-type UUIDs, etc. — only concept UUIDs are
//     reachable from concepts.json. Other entity UUIDs would need their own
//     bundle file scan, doable as a follow-up.
//
// Return shape mirrors src/bundle.js's validator:
//   { valid, errors: [{level, code, message, loc?}], warnings: [...] }

import { parse } from "acorn";
import { simple as walkSimple, ancestor as walkAncestor } from "acorn-walk";

const JS_STANDARD_GLOBALS = new Set([
  // ECMAScript intrinsics rules legitimately use
  "Math", "Date", "Object", "Array", "Number", "String", "Boolean",
  "Map", "Set", "WeakMap", "WeakSet", "Symbol", "RegExp", "JSON",
  "Error", "TypeError", "RangeError",
  "Promise", "Infinity", "NaN", "undefined", "null", "true", "false",
  "isNaN", "isFinite", "parseInt", "parseFloat",
  // safe-eval also exposes console
  "console",
  // legacy underscore alias seen in rules-config evalRule.js context
  "_",
  // rules-server injects this into the safe-eval context (confirmed in
  // docs/rules-brain/02-execution-context.md from evalRule.js:6-13)
  "ruleServiceLibraryInterfaceForSharingModules",
]);

const BLOCKED_GLOBALS = new Set([
  "require", "process", "global", "globalThis", "eval", "Function",
  "fetch", "XMLHttpRequest", "WebSocket", "import",
  "module", "exports", "__dirname", "__filename",
  "Buffer", "setTimeout", "setInterval", "setImmediate", "clearTimeout",
  "clearInterval", "clearImmediate", "queueMicrotask",
]);

const IMPORTS_WHITELIST = new Set([
  "rulesConfig", "common", "lodash", "moment", "motherCalculations",
  "log", "models",
]);

// 13 classes published from rules-config's rules.js.
const RULESCONFIG_CLASSES = new Set([
  "RuleRegistry", "FormElementsStatusHelper", "RuleCondition",
  "AdditionalComplicationsBuilder", "SkipLogic", "complicationsBuilder",
  "FormElementStatusBuilder", "StatusBuilderAnnotationFactory",
  "VisitScheduleBuilder", "FormElementStatus", "WithName", "lib",
  "ActionEligibilityResponse",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code, message, loc) {
  return { level: "error", code, message, loc };
}
function warn(code, message, loc) {
  return { level: "warning", code, message, loc };
}

/**
 * Validate one rule body.
 * @param {string} ruleBody the JS string from a bundle JSON field.
 * @param {object} opts
 * @param {Set<string>=} opts.conceptUuids set of all conceptUuid values from concepts.json.
 *   If omitted, concept-UUID liveness check is skipped (returns warnings instead of errors).
 * @param {string=} opts.fieldName for error context.
 */
export function validateRuleBody(ruleBody, { conceptUuids, fieldName = "rule" } = {}) {
  const errors = [];
  const warnings = [];

  if (!ruleBody || typeof ruleBody !== "string" || ruleBody.trim() === "") {
    return { valid: true, errors, warnings }; // empty rule body is fine
  }

  // 1. Parse
  let ast;
  try {
    ast = parse(ruleBody, { ecmaVersion: 2022, sourceType: "script", locations: true });
  } catch (e) {
    return {
      valid: false,
      errors: [err("R1-SYNTAX", `${fieldName}: parse error: ${e.message}`, { line: e.loc?.line })],
      warnings,
    };
  }

  // 2. Wrapper check — first non-directive top-level statement must be
  //    an expression whose value is an arrow or function expression
  //    accepting ({params, imports}) or (params, imports).
  const stmts = ast.body.filter((n) => n.type !== "ExpressionStatement" || n.expression.type !== "Literal");
  const directive = ast.body.find((n) => n.type === "ExpressionStatement" && n.expression.type === "Literal" && n.expression.value === "use strict");
  void directive; // optional, not required
  const exprStmt = stmts[0];
  if (!exprStmt || exprStmt.type !== "ExpressionStatement") {
    errors.push(err("R2-WRAPPER", `${fieldName}: expected top-level arrow/function expression`));
  } else {
    const expr = exprStmt.expression;
    const ok = (expr.type === "ArrowFunctionExpression" || expr.type === "FunctionExpression");
    if (!ok) {
      errors.push(err("R2-WRAPPER", `${fieldName}: top-level must be an arrow or function expression, got ${expr.type}`));
    } else {
      // Check params: either ({params, imports}) destructuring, or (params, imports) positional.
      const p = expr.params;
      const isDestructured = p.length === 1 && p[0].type === "ObjectPattern" &&
        p[0].properties.length >= 2 &&
        p[0].properties.some((pp) => pp.key?.name === "params") &&
        p[0].properties.some((pp) => pp.key?.name === "imports");
      const isPositional = p.length >= 2 && p[0].type === "Identifier" && p[0].name === "params" &&
        p[1].type === "Identifier" && p[1].name === "imports";
      if (!isDestructured && !isPositional) {
        errors.push(err("R2-WRAPPER", `${fieldName}: function must accept {params, imports} or (params, imports)`));
      }
    }
  }

  // 3+4+5+6 — walk identifiers and member accesses
  // Track locally-declared bindings so we don't flag them as unknown globals.
  const locals = new Set();
  walkSimple(ast, {
    VariableDeclarator(node) {
      if (node.id?.type === "Identifier") locals.add(node.id.name);
      if (node.id?.type === "ObjectPattern") {
        for (const prop of node.id.properties) {
          if (prop.value?.type === "Identifier") locals.add(prop.value.name);
          else if (prop.key?.type === "Identifier") locals.add(prop.key.name);
        }
      }
      if (node.id?.type === "ArrayPattern") {
        for (const el of node.id.elements) if (el?.type === "Identifier") locals.add(el.name);
      }
    },
    FunctionDeclaration(node) { if (node.id) locals.add(node.id.name); },
    FunctionExpression(node) {
      for (const p of node.params) if (p?.type === "Identifier") locals.add(p.name);
    },
    ArrowFunctionExpression(node) {
      for (const p of node.params) {
        if (p?.type === "Identifier") locals.add(p.name);
        else if (p?.type === "ObjectPattern") for (const pp of p.properties) if (pp.value?.type === "Identifier") locals.add(pp.value.name);
      }
    },
    CatchClause(node) { if (node.param?.type === "Identifier") locals.add(node.param.name); },
  });

  // Identifier + UUID + member-access checks
  walkAncestor(ast, {
    Identifier(node, _state, ancestors) {
      const name = node.name;
      // Skip property keys (not references) and computed property names handled separately
      const parent = ancestors[ancestors.length - 2];
      if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return;
      if (parent?.type === "Property" && parent.key === node && !parent.computed) return;
      // Skip declarations / param positions
      if (parent?.type === "VariableDeclarator" && parent.id === node) return;
      if (parent?.type === "FunctionDeclaration" && parent.id === node) return;
      if (parent?.type === "AssignmentPattern" && parent.left === node) return;

      if (BLOCKED_GLOBALS.has(name)) {
        errors.push(err("R3-BLOCKED-GLOBAL", `${fieldName}: forbidden global "${name}"`, node.loc?.start));
        return;
      }
      if (locals.has(name)) return;
      if (JS_STANDARD_GLOBALS.has(name)) return;
      if (name === "params" || name === "imports") return;
      // The eligibility template binds `eligibility`; visit-schedule binds
      // `scheduleBuilder`; etc. These are introduced by templates and aren't
      // declared via VariableDeclarator with an Identifier (some are `const`
      // bindings we did catch). Catch the rest as warnings, not errors.
      warnings.push(warn("R3-UNKNOWN-IDENT", `${fieldName}: unknown identifier "${name}" (not a local, not a whitelisted global)`, node.loc?.start));
    },
    MemberExpression(node) {
      // imports.X — X must be in IMPORTS_WHITELIST
      if (node.object?.type === "Identifier" && node.object.name === "imports" && node.property?.type === "Identifier" && !node.computed) {
        if (!IMPORTS_WHITELIST.has(node.property.name)) {
          errors.push(err("R4-BAD-IMPORT", `${fieldName}: imports.${node.property.name} is not injected by rules-server (use one of ${[...IMPORTS_WHITELIST].join(", ")})`, node.loc?.start));
        }
      }
      // imports.rulesConfig.X — X must be a known class
      if (node.object?.type === "MemberExpression"
          && node.object.object?.type === "Identifier" && node.object.object.name === "imports"
          && node.object.property?.type === "Identifier" && node.object.property.name === "rulesConfig"
          && node.property?.type === "Identifier" && !node.computed) {
        if (!RULESCONFIG_CLASSES.has(node.property.name)) {
          errors.push(err("R5-BAD-RULESCONFIG-CLASS", `${fieldName}: imports.rulesConfig.${node.property.name} is not a known export (expected one of: ${[...RULESCONFIG_CLASSES].join(", ")})`, node.loc?.start));
        }
      }
    },
    Literal(node) {
      // Concept-UUID liveness — only when conceptUuids was supplied.
      if (typeof node.value !== "string") return;
      if (!UUID_RE.test(node.value)) return;
      if (!conceptUuids) {
        warnings.push(warn("R6-UUID-UNCHECKED", `${fieldName}: UUID literal "${node.value}" not cross-checked (no concepts.json provided)`, node.loc?.start));
        return;
      }
      if (!conceptUuids.has(node.value.toLowerCase())) {
        // This may be a non-concept UUID (encounterType, subjectType, etc.) —
        // we can't tell without scanning every entity file. Emit a warning,
        // not an error, to avoid false positives.
        warnings.push(warn("R6-UUID-UNKNOWN", `${fieldName}: UUID literal "${node.value}" is not a concept UUID in concepts.json (may be encounter-type/subject-type — verify manually)`, node.loc?.start));
      }
    },
  });

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate every rule body across a bundle directory.
 * Scans forms/*.json, encounterTypes.json, programs.json, subjectTypes.json,
 * organisationConfig.json for any of the 12 rule fields. Returns aggregate.
 */
export async function validateBundleRules(bundleDir) {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const conceptsPath = path.join(bundleDir, "concepts.json");
  let conceptUuids;
  if (fs.existsSync(conceptsPath)) {
    try {
      const conc = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
      // concepts.json may be { concepts: [...] } or top-level array
      const arr = Array.isArray(conc) ? conc : (conc.concepts || []);
      conceptUuids = new Set(arr.map((c) => (c.uuid || "").toLowerCase()).filter(Boolean));
    } catch {}
  }

  const aggregate = { byFile: {}, errors: [], warnings: [] };

  function pushErr(rec) { aggregate.errors.push(rec); }
  function pushWarn(rec) { aggregate.warnings.push(rec); }

  function check(filePath, fieldName, body) {
    const r = validateRuleBody(body, { conceptUuids, fieldName: `${path.relative(bundleDir, filePath)}#${fieldName}` });
    if (r.errors.length || r.warnings.length) {
      aggregate.byFile[path.relative(bundleDir, filePath)] = aggregate.byFile[path.relative(bundleDir, filePath)] || { errors: [], warnings: [] };
      aggregate.byFile[path.relative(bundleDir, filePath)].errors.push(...r.errors);
      aggregate.byFile[path.relative(bundleDir, filePath)].warnings.push(...r.warnings);
      r.errors.forEach(pushErr);
      r.warnings.forEach(pushWarn);
    }
  }

  const RULE_FIELDS_FORM = [
    "decisionRule", "visitScheduleRule", "validationRule",
    "checklistsRule", "editFormRule",
  ];
  const RULE_FIELDS_ENC = ["encounterEligibilityCheckRule"];
  const RULE_FIELDS_PROG = ["enrolmentEligibilityCheckRule", "manualEnrolmentEligibilityCheckRule", "enrolmentSummaryRule"];
  const RULE_FIELDS_SUBJ = ["subjectSummaryRule"];
  const RULE_FIELDS_ORG  = ["worklistUpdationRule"];

  function scanJson(filePath, fields) {
    if (!fs.existsSync(filePath)) return;
    let json;
    try { json = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return; }
    const items = Array.isArray(json) ? json : [json];
    for (const item of items) {
      for (const f of fields) {
        if (typeof item[f] === "string" && item[f].trim()) check(filePath, f, item[f]);
      }
    }
  }

  // forms/*.json
  const formsDir = path.join(bundleDir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      const fp = path.join(formsDir, fn);
      let form; try { form = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
      for (const f of RULE_FIELDS_FORM) {
        if (typeof form[f] === "string" && form[f].trim()) check(fp, f, form[f]);
      }
      // formElement-level rules
      for (const group of (form.formElementGroups || [])) {
        for (const el of (group.formElements || [])) {
          if (typeof el.rule === "string" && el.rule.trim()) {
            check(fp, `formElement[${el.name || el.uuid}].rule`, el.rule);
          }
        }
      }
    }
  }
  scanJson(path.join(bundleDir, "encounterTypes.json"), RULE_FIELDS_ENC);
  scanJson(path.join(bundleDir, "programs.json"), RULE_FIELDS_PROG);
  scanJson(path.join(bundleDir, "subjectTypes.json"), RULE_FIELDS_SUBJ);
  scanJson(path.join(bundleDir, "organisationConfig.json"), RULE_FIELDS_ORG);

  return aggregate;
}
