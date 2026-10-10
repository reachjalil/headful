import { expect, it } from "vite-plus/test";
import {
  headfulModDescriptorSchema,
  headfulModManifestSchema,
  resolveHeadfulContributions,
} from "@t3tools/contracts/headful-mods";
import example from "../../../../../examples/hello-mod/headful.mod.json";
import { resolveEditorContributions } from "./editor-contributions";

function descriptor() {
  return headfulModDescriptorSchema.parse({
    manifest: example,
    enabled: true,
    compatible: true,
    status: "inactive",
    artifactRevision: "revision-one",
    grantedPermissions: example.permissions,
  });
}
it("makes a reviewed dormant community tool discoverable without treating metadata as activation", () => {
  const mod = descriptor();
  const graph = resolveEditorContributions([mod], [], {});
  expect(graph.tools[0]).toMatchObject({
    available: true,
    pinned: false,
    revision: "revision-one",
    contribution: { surfaceId: "overview" },
  });
  expect(graph.actions[0]).toMatchObject({ available: true, needsConfiguration: false });
  expect(mod.status).toBe("inactive");
  for (const altered of [
    { ...mod, enabled: false },
    { ...mod, compatible: false },
    { ...mod, grantedPermissions: [] },
    { ...mod, status: "failed" as const },
  ]) {
    expect(resolveEditorContributions([altered], [], {}).tools[0]?.available).toBe(false);
    expect(resolveEditorContributions([altered], [], {}).actions[0]?.available).toBe(false);
  }
});
it("inherits feature requirements from referenced views and commands", () => {
  const mod = descriptor();
  mod.manifest.contributions.surfaces[0]!.requiredFeatures = ["org.example.hello/view"];
  mod.manifest.contributions.commands[0]!.requiredFeatures = ["org.example.hello/command"];
  const hidden = resolveHeadfulContributions([mod], []);
  expect(hidden.navigation[0]?.unavailableReason).toContain("org.example.hello/view");
  expect(hidden.actions[0]?.unavailableReason).toContain("org.example.hello/command");
});
it("rejects ambiguous, foreign or missing navigation targets and native DOM contributions from community code", () => {
  for (const navigation of [
    { id: "org.example.hello/tool", name: "Missing target" },
    { id: "org.example.hello/tool", name: "Unknown surface", surfaceId: "missing" },
    { id: "other.owner/tool", name: "Foreign identity", surfaceId: "overview" },
    {
      id: "org.example.hello/tool",
      name: "Ambiguous",
      surfaceId: "overview",
      componentId: "org.example.hello/native",
    },
    { id: "org.example.hello/tool", name: "Native code", componentId: "org.example.hello/native" },
  ]) {
    const manifest = {
      ...example,
      contributions: {
        ...example.contributions,
        components: [{ id: "org.example.hello/native", kind: "panel" }],
        navigation: [navigation],
      },
    };
    expect(headfulModManifestSchema.safeParse(manifest).success).toBe(false);
  }
});
it("routes commands needing user inputs to configuration and keeps deterministic ordering", () => {
  const mod = descriptor();
  mod.manifest.contributions.commands[0]!.parameters = [
    { key: "name", type: "string", required: true, secret: false },
  ];
  mod.manifest.contributions.navigation.push({
    ...mod.manifest.contributions.navigation[0]!,
    id: "org.example.hello/another",
  });
  const graph = resolveEditorContributions([mod], [], {});
  expect(graph.actions[0]?.needsConfiguration).toBe(true);
  expect(graph.tools.map((tool) => tool.contribution.id)).toEqual([
    "org.example.hello/another",
    "org.example.hello/counter",
  ]);
});
