import type { HeadfulAgentBoundary } from "../../../../packages/contracts/src/headful-agent.ts";
let now = () => 0;
let resolveBoundary: ((threadId: string) => HeadfulAgentBoundary) | undefined;

/** Only the native host installs this resolver. The reserved thread namespace
 * fails closed before provider I/O if authority is missing after a restart. */
export function installAgentBoundaryResolver(
  resolve: (threadId: string) => HeadfulAgentBoundary,
  time: () => number,
) {
  if (resolveBoundary) throw new Error("A native agent authority is already installed.");
  resolveBoundary = resolve;
  now = time;
  return () => {
    if (resolveBoundary === resolve) resolveBoundary = undefined;
  };
}
export function nativeAgentBoundary(threadId: string): HeadfulAgentBoundary | undefined {
  if (!threadId.startsWith("headful-agent-")) return undefined;
  const boundary = resolveBoundary?.(threadId);
  if (
    !boundary ||
    boundary.threadId !== threadId ||
    boundary.revokedAt ||
    boundary.expiresAt <= now()
  )
    throw new Error("Native agent authority is unavailable.");
  return boundary;
}
