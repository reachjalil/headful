#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, "assets/headful");
await fs.mkdir(dir, { recursive: true });
const raw = await fs.readFile(path.join(dir, "helmet.svg"), "utf8");
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
    .toFile(path.join(dir, `tray-${name}.png`));
const app = raw
  .replace(
    '<g id="helmet-shell"',
    '<rect x="20" y="20" width="472" height="472" rx="112" fill="#11182b"/><g id="helmet-shell"',
  )
  .replace("Headful Cloud", "Headful");
await sharp(Buffer.from(app)).resize(1024, 1024).png().toFile(path.join(dir, "icon-1024.png"));
for (const size of [16, 32, 180, 192, 512])
  await sharp(Buffer.from(app))
    .resize(size, size)
    .png()
    .toFile(path.join(dir, `icon-${size}.png`));
await fs.copyFile(
  path.join(dir, "icon-1024.png"),
  path.join(root, "apps/desktop/resources/icon.png"),
);
for (const [source, target] of [
  ["icon-16.png", "favicon-16x16.png"],
  ["icon-32.png", "favicon-32x32.png"],
  ["icon-180.png", "apple-touch-icon.png"],
  ["helmet.svg", "favicon.svg"],
])
  await fs.copyFile(path.join(dir, source), path.join(root, "apps/web/public", target));
console.log("Headful app and org-colored tray icons generated.");
