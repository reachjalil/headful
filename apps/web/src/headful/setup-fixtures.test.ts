import { expect, it } from "vite-plus/test";
import { createSetupFixture } from "./setup-fixtures";
it("all design fixtures obey the runtime contracts", async () => {
  for (const fixture of ["ready", "missing", "unsupported", "empty", "expired"] as const) {
    const dispatch = createSetupFixture(fixture);
    expect(await dispatch("features.list", {})).toHaveProperty("onboardingComplete", false);
    await dispatch("cli.detect", {});
    await dispatch("orgs.list", {});
    await dispatch("orgs.discover", {});
    if (fixture === "ready") await dispatch("orgs.sandboxes", { orgId: "fixture_production" });
  }
});
