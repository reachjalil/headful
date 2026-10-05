import { z } from "zod";
import {
  headfulExtensionManifestSchema,
  type HeadfulExtensionDefinition,
  type HeadfulExtensionManifest,
} from "@t3tools/contracts/headful-extensions";
import { identifier } from "@t3tools/contracts/headful-workspace/contract-schema";
import registration from "../headful.extension.json" with { type: "json" };

/** Identity and native contributions come from the same JSON used by the
 * reviewed package loader. Utility business logic remains in the core runtime. */
export const manifest: HeadfulExtensionManifest =
  headfulExtensionManifestSchema.parse(registration);
const orgInput = z.strictObject({ "org-id": identifier });
const destinations = {
  "admin-utilities/open-org": "home",
  "admin-utilities/open-setup": "setup",
  "admin-utilities/open-users-setup": "users",
  "admin-utilities/open-permission-sets-setup": "permission-sets",
} as const;

const definition: HeadfulExtensionDefinition = {
  manifest,
  async activate(context) {
    context.requireActive();
    context.requireFeature("org-management");
    let disposed = false;
    const requireActive = () => {
      if (disposed) throw new Error("Admin Utilities has stopped.");
      context.requireActive();
    };
    return {
      dispose: () => {
        disposed = true;
      },
      onFeatureChange: () => {
        /* On-demand operations; no background CLI process. */
      },
      async dispatchCommand(command, input) {
        requireActive();
        context.requireFeature("admin-utilities/org-shortcuts");
        const { "org-id": orgId } = orgInput.parse(input);
        if (command === "admin-utilities/connection-status") {
          const status = await context.runtime.dispatch("status", {}, { kind: "desktop" });
          requireActive();
          const org = status.orgs.find((connection) => connection.id === orgId);
          if (!org) throw new Error("The selected org is no longer imported in Headful.");
          return {
            message: `${org.label} · ${org.isSandbox === true ? "Sandbox" : org.isSandbox === false ? "Production" : "Environment not verified"} · ${org.status}. Salesforce org ${org.salesforceOrgId}.`,
            values: {
              "org-id": org.id,
              "salesforce-org-id": org.salesforceOrgId,
              status: org.status,
            },
          };
        }
        if (!Object.hasOwn(destinations, command))
          throw new Error("This utility command is unavailable.");
        // The command chooses from fixed supported destinations. No URL, shell,
        // CLI arguments, credential operation or provider-write input is accepted.
        const destination = destinations[command as keyof typeof destinations];
        await context.runtime.dispatch(
          "utilities.org.open",
          { orgId, destination },
          { kind: "desktop" },
        );
        requireActive();
        return {
          message: `Opened ${destination === "home" ? "the selected org" : "Salesforce " + destination} in your browser.`,
          values: { "org-id": orgId, opened: true },
        };
      },
      async renderSurface(surfaceId) {
        requireActive();
        if (surfaceId !== "overview") throw new Error("This utility surface is unavailable.");
        return {
          title: "Admin Utilities · open source",
          markdown:
            "The MIT-licensed Admin Utilities extension contributes org shortcuts, read-only record inspection, bounded SOQL, object and field exploration, and supported diagnostics to the shared Headful workspace.\n\nAll Salesforce operations use the trusted local sf CLI service and an explicitly selected org. Credentials remain CLI-owned. Saved queries, history, favorites and header preferences remain local.\n\nThe extension has no Salesforce write, Apex execution, approval, backup or restore capability. Users & Access and Permission Sets continue through Headful’s existing exact human review flows.",
        };
      },
    };
  },
};
export default definition;
