// Adapted for the public Headful desktop from the original Headful workspace.
import { z } from "zod";

export const salesforceV2LeadStatusSchema = z.enum([
  "Open - Not Contacted",
  "Working - Contacted",
  "Closed - Not Converted",
]);

export const salesforceV2LeadSourceSchema = z.enum([
  "Web",
  "Phone Inquiry",
  "Partner Referral",
  "Purchased List",
  "Other",
]);

export const salesforceV2LeadSalutations = ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof.", "Mx."] as const;

export const salesforceV2LeadAddressSchema = z
  .object({
    street: z.string().max(500),
    postalCode: z.string().max(80),
    city: z.string().max(300),
    state: z.string().max(300),
    country: z.string().max(300),
  })
  .strict();

export const salesforceV2LeadSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1),
    salutation: z.enum(salesforceV2LeadSalutations).nullable().default(null),
    title: z.string().min(1),
    company: z.string().min(1),
    status: z.string().trim().min(1).max(500),
    source: z.string().trim().min(1).max(500).nullable().default(null),
    rating: z.enum(["Hot", "Warm", "Cold"]).nullable().default(null),
    email: z.email().nullable().default(null),
    website: z.url().nullable().default(null),
    phone: z.string().trim().min(1).max(300).nullable().default(null),
    mobile: z.string().trim().min(1).max(300).nullable().default(null),
    fax: z.string().trim().min(1).max(300).nullable().default(null),
    industry: z.string().trim().min(1).max(500).nullable().default(null),
    address: salesforceV2LeadAddressSchema.nullable().default(null),
    annualRevenue: z.int().nonnegative().nullable().default(null),
    employees: z.int().positive().nullable().default(null),
    createdAt: z.iso.datetime().nullable().default(null),
    lastActivityAt: z.iso.datetime().nullable().default(null),
    important: z.boolean().nullable().default(null),
    description: z.string().min(1).nullable().default(null),
  })
  .strict();

export const salesforceV2LeadListScenarioSchema = z
  .object({
    scenario: z.literal("salesforce-v2-lead-list"),
    apiVersion: z.literal("v1"),
    provider: z.literal("salesforce"),
    fictional: z.boolean(),
    referenceTime: z.iso.datetime(),
    source: z
      .object({
        fixtureId: z.string().min(1).max(160),
        object: z.literal("Lead"),
        authority: z.enum(["fixture-only-no-provider-connection", "host-supplied-unverified"]),
        totalCount: z.int().nonnegative(),
        workingCount: z.int().nonnegative(),
        activityCounts: z
          .object({
            noActivity: z.int().nonnegative(),
            idle: z.int().nonnegative(),
            noUpcoming: z.int().nonnegative(),
            overdue: z.int().nonnegative(),
            dueToday: z.int().nonnegative(),
            upcoming: z.int().nonnegative(),
          })
          .strict()
          .optional(),
        dataCompleteness: z.enum(["full", "summary"]).default("full"),
      })
      .strict(),
    presentation: z
      .object({
        objectLabel: z.literal("Leads"),
        listViewName: z.literal("My Leads"),
        question: z.literal("Which lead should you review next?"),
        createdFilter: z.enum(["This Quarter", "All accessible records"]),
        ownerFilter: z.enum(["Me", "Connected scope"]),
        leads: z.array(salesforceV2LeadSchema).max(16),
      })
      .strict(),
  })
  .strict()
  .superRefine((scenario, context) => {
    const ids = new Set(scenario.presentation.leads.map(({ id }) => id));
    const emailValues = scenario.presentation.leads.flatMap(({ email }) =>
      email ? [email.toLowerCase()] : [],
    );
    const emails = new Set(emailValues);
    if (ids.size !== scenario.presentation.leads.length) {
      context.addIssue({
        code: "custom",
        path: ["presentation", "leads"],
        message: "Salesforce lead identities must be unique",
      });
    }
    if (emails.size !== emailValues.length) {
      context.addIssue({
        code: "custom",
        path: ["presentation", "leads"],
        message: "Salesforce lead emails must be unique",
      });
    }
    if (scenario.source.workingCount > scenario.source.totalCount) {
      context.addIssue({
        code: "custom",
        path: ["source", "workingCount"],
        message: "Working lead count cannot exceed the total lead count",
      });
    }
    for (const [key, count] of Object.entries(scenario.source.activityCounts ?? {})) {
      if (count <= scenario.source.totalCount) continue;
      context.addIssue({
        code: "custom",
        path: ["source", "activityCounts", key],
        message: "Activity count cannot exceed the total lead count",
      });
    }
  });

export type SalesforceV2LeadListScenario = z.infer<typeof salesforceV2LeadListScenarioSchema>;
export type SalesforceV2Lead = SalesforceV2LeadListScenario["presentation"]["leads"][number];
export type SalesforceV2LeadStatus = z.infer<typeof salesforceV2LeadStatusSchema>;
export type SalesforceV2LeadSource = z.infer<typeof salesforceV2LeadSourceSchema>;
