/**
 * Prove dev-only experiences, fixtures and app control are absent from a production web build.
 *
 *   node scripts/headful-exposure-check.mjs <built web dist directory>
 *
 * Scans shipped JavaScript only (source maps are not executable). Fails on the first leak class.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { headfulExperiences } from "../packages/contracts/src/headful-experiences.ts";

const dist = process.argv[2];
if (!dist) throw new Error("Usage: headful:exposure <web dist directory>");
const files = (await NodeFSP.readdir(dist, { recursive: true }))
  .filter((file) => file.endsWith(".js"))
  .map((file) => NodePath.join(dist, file));

const forbidden = [
  ["experience control", /__headfulExperienceControl/],
  ["WebMCP recipe tool", /headful_experience_recipe/],
  ["fixture module", /fixtures are development-only/],
  ...Object.entries(headfulExperiences)
    .filter(([, definition]) => definition.exposure === "dev-only")
    .map(([id]) => [
      `dev-only experience ${id}`,
      new RegExp(`["'\`]?data-experience["'\`]?:\\s*["'\`]${id}["'\`]`),
    ]),
];
// Development-only modules must not exist as chunks, even unreferenced ones.
const devChunks =
  /^(SetupPreview|AdminWorkspacePreview|LeadReviewPreview|ModPreviews|experience-views|experience-control|setup-fixtures|fixtures)-/;
const leaks = files
  .filter((file) => devChunks.test(NodePath.basename(file)))
  .map((file) => `dev-only chunk ${NodePath.relative(dist, file)}`);
for (const file of files) {
  const text = await NodeFSP.readFile(file, "utf8");
  for (const [label, pattern] of forbidden)
    if (pattern.test(text)) leaks.push(`${label} in ${NodePath.relative(dist, file)}`);
}
// Positive control: the marker pattern must find every enabled experience, or the scan proves nothing.
for (const [id, definition] of Object.entries(headfulExperiences)) {
  if (definition.exposure !== "enabled") continue;
  const marker = new RegExp(`["'\`]?data-experience["'\`]?:\\s*["'\`]${id}["'\`]`);
  let found = false;
  for (const file of files) if (marker.test(await NodeFSP.readFile(file, "utf8"))) found = true;
  if (!found) leaks.push(`marker pattern did not find enabled experience ${id}; check is invalid`);
}
const enabled = Object.entries(headfulExperiences)
  .filter(([, definition]) => definition.exposure === "enabled")
  .map(([id]) => id);
console.log(
  leaks.length
    ? `LEAK ${leaks.length} · ${leaks.join("\n  ")}`
    : `CLEAN ${files.length} JS files · enabled: ${enabled.join(", ")} · ${forbidden.length} dev-only markers absent`,
);
process.exit(leaks.length ? 1 : 0);
