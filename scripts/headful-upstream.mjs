#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const run = (args) => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status) throw new Error(result.stderr.trim());
  return result.stdout.trim();
};
const command = process.argv[2] || "status";
if (!["status", "prepare"].includes(command))
  throw new Error("Use status or prepare [ref]. No automated merge or release.");
const base = JSON.parse(readFileSync(new URL("../headful-upstream.json", import.meta.url), "utf8"));
const remote = spawnSync("git", ["remote", "get-url", "upstream"], { cwd: root, encoding: "utf8" });
if (remote.status) run(["remote", "add", "upstream", base.repository]);
else if (
  !/^https:\/\/github\.com\/pingdotgg\/t3code(?:\.git)?$|^git@github\.com:pingdotgg\/t3code(?:\.git)?$/.test(
    remote.stdout.trim(),
  )
)
  throw new Error("The upstream remote must be pingdotgg/t3code. Inspect it before fetching.");
run(["fetch", "upstream", "main", "--tags"]);
const target = process.argv[3] || "upstream/main";
const sha = run(["rev-parse", "--verify", `${target}^{commit}`]);
console.log(
  `Headful base: ${base.commit}\nCandidate: ${sha}\nIncoming changes:\n${run(["log", "--oneline", `${base.commit}..${sha}`]) || "None"}`,
);
if (command === "prepare") {
  if (run(["status", "--porcelain"]))
    throw new Error("Commit or save local work before preparing integration.");
  const branch = `codex/headful-upstream-${sha.slice(0, 8)}`;
  run(["switch", "-c", branch]);
  console.log(
    `Prepared ${branch}. Review docs/headful/upstream.md, then git merge --no-ff ${sha}. No merge or publish was performed.`,
  );
}
