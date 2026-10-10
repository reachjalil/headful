#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import sharp from "sharp";
const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const dir = NodePath.join(root, "assets/headful");
await NodeFSP.mkdir(dir, { recursive: true });
const raw = await NodeFSP.readFile(NodePath.join(dir, "helmet.svg"), "utf8");
const colors = {
  violet: "#626dd2",
  lime: "#6e9d21",
  blue: "#257bc0",
  orange: "#c8751c",
  rose: "#bc4475",
  template: "#000000",
};
for (const [name, color] of Object.entries(colors))
  await sharp(
    Buffer.from(raw.replace("color:#fff", `color:${color}`).replace("Headful Cloud", "Headful")),
  )
    .resize(44, 44)
    .png()
    .toFile(NodePath.join(dir, `tray-${name}.png`));
const app = raw
  .replace(
    '<g id="helmet-shell"',
    '<rect x="20" y="20" width="472" height="472" rx="112" fill="#11182b"/><g id="helmet-shell"',
  )
  .replace("Headful Cloud", "Headful");
await sharp(Buffer.from(app)).resize(1024, 1024).png().toFile(NodePath.join(dir, "icon-1024.png"));
for (const size of [16, 32, 180, 192, 512])
  await sharp(Buffer.from(app))
    .resize(size, size)
    .png()
    .toFile(NodePath.join(dir, `icon-${size}.png`));
await NodeFSP.copyFile(
  NodePath.join(dir, "icon-1024.png"),
  NodePath.join(root, "apps/desktop/resources/icon.png"),
);
for (const [source, target] of [
  ["icon-16.png", "favicon-16x16.png"],
  ["icon-32.png", "favicon-32x32.png"],
  ["icon-180.png", "apple-touch-icon.png"],
  ["helmet.svg", "favicon.svg"],
])
  await NodeFSP.copyFile(
    NodePath.join(dir, source!),
    NodePath.join(root, "apps/web/public", target!),
  );
console.log("Headful app and org-colored tray icons generated.");
