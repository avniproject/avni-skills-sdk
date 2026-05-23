// mountRoutes(app) — wires every route module onto the Express app.
// Each module exports `register(app)`; this file owns the order.

import * as health from "./health.js";
import * as skills from "./skills.js";
import * as bundles from "./bundles.js";
import * as agentQuery from "./agent-query.js";
import * as sessionsLifecycle from "./sessions-lifecycle.js";
import * as sessionsEdit from "./sessions-edit.js";
import * as sessionsMessages from "./sessions-messages.js";
import * as sessionsAgentMessages from "./sessions-agent-messages.js";
import * as sessionsObservability from "./sessions-observability.js";
import * as sessionsRules from "./sessions-rules.js";
import * as sessionsSummaryEvaluate from "./sessions-summary-evaluate.js";

export function mountRoutes(app) {
  health.register(app);
  skills.register(app);
  bundles.register(app);
  agentQuery.register(app);
  sessionsLifecycle.register(app);
  sessionsEdit.register(app);
  sessionsMessages.register(app);
  sessionsAgentMessages.register(app);
  sessionsObservability.register(app);
  sessionsRules.register(app);
  sessionsSummaryEvaluate.register(app);
}
