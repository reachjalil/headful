// @effect-diagnostics nodeBuiltinImport:off
import { createHmac, randomBytes } from "node:crypto";

// Main-process lifetime only. Never persisted, exposed through preload, or sent
// to a harness. The single primary backend receives it through its private env.
export const desktopCapability = randomBytes(32).toString("base64url");
export const signDesktopRequest = (body: string): string =>
  createHmac("sha256", Buffer.from(desktopCapability, "base64url"))
    .update(body, "utf8")
    .digest("base64url");
