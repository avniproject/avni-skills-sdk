// agents/index.js — registry of the three bundle-authoring agents.
//
// The SDK's /v1/sessions/:id/messages endpoint defaults to a single
// monolithic bundle-edit agent. The future structured-output endpoint
// (next increment of WS5) will let callers pick which specialised agent
// to dispatch.

export { SPEC_AGENT }          from "./spec-agent.js";
export { BUNDLE_CONFIG_AGENT } from "./bundle-config-agent.js";
export { REVIEW_AGENT }        from "./review-agent.js";

import { SPEC_AGENT }          from "./spec-agent.js";
import { BUNDLE_CONFIG_AGENT } from "./bundle-config-agent.js";
import { REVIEW_AGENT }        from "./review-agent.js";

export const AGENTS_BY_NAME = Object.freeze({
  spec:            SPEC_AGENT,
  "bundle-config": BUNDLE_CONFIG_AGENT,
  review:          REVIEW_AGENT,
});

export function getAgent(name) {
  return AGENTS_BY_NAME[name] || null;
}

export function listAgentNames() {
  return Object.keys(AGENTS_BY_NAME);
}
