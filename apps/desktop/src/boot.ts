// @effect-diagnostics nodeBuiltinImport:off
// Headful never inherits the running T3 app's data or telemetry configuration.
const path = require("node:path");
const os = require("node:os");
process.env.T3CODE_HOME = process.env.HEADFUL_HOME || path.join(os.homedir(), ".headful");
process.env.T3CODE_POSTHOG_KEY = "";
process.env.T3CODE_TELEMETRY_ENABLED = "false";
process.env.T3CODE_RELAY_URL = "";
process.env.T3CODE_CLERK_PUBLISHABLE_KEY = "";
for (const key of ["T3CODE_OTLP_TRACES_URL", "T3CODE_OTLP_METRICS_URL", "T3CODE_OTLP_LOGS_URL"])
  delete process.env[key];
// Packaged app entry. Enables the compile cache before the main bundle loads,
// so the cache also covers main.cjs itself.
require("./compileCache.cjs");
require("./main.cjs");
