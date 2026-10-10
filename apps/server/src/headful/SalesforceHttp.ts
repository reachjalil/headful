// Native HTTP adapter: credentials stay in the runtime and response bodies are always consumed or cancelled.
// @effect-diagnostics globalFetch:off
import { HttpError } from "./domain/types.ts";

export function assertSalesforceRequest(path: string, init: RequestInit, write: boolean) {
  const pathname = path.split("?")[0] ?? "";
  const method = (init.method ?? "GET").toUpperCase();
  if (
    path.length > 20000 ||
    !/^\/services\/data\/v\d{2,3}\.0\/[A-Za-z0-9_./-]+(?:\?[^\s#]*)?$/.test(path) ||
    pathname.includes("..") ||
    pathname.includes("//") ||
    /\/executeAnonymous\b/i.test(pathname)
  )
    throw new HttpError(400, "provider_path", "This Salesforce operation is unavailable.");
  if (
    !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method) ||
    (method !== "GET" && !write) ||
    (method === "GET" && init.body != null)
  )
    throw new HttpError(
      400,
      "provider_method",
      "Use the reviewed write boundary for Salesforce changes.",
    );
}

export async function salesforceJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  write = false,
  maximum = 4 * 1024 * 1024,
) {
  // A cancellation before dispatch establishes that no provider request was made.
  if (init.signal?.aborted)
    throw new HttpError(
      409,
      "provider_cancelled",
      "This Salesforce request was cancelled before dispatch.",
    );
  const timeout = AbortSignal.timeout(20000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("accept", "application/json");
  if (init.body != null && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal,
      redirect: "error",
      cache: "no-store",
    });
    const reader = response.body?.getReader();
    let raw = "";
    let length = 0;
    const decoder = new TextDecoder();
    try {
      if (Number(response.headers.get("content-length")) > maximum)
        throw new HttpError(
          502,
          "provider_bound",
          "Salesforce response exceeded its supported size.",
        );
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maximum)
            throw new HttpError(
              502,
              "provider_bound",
              "Salesforce response exceeded its supported size.",
            );
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
    if (write && (response.status >= 500 || response.status === 408))
      throw new HttpError(
        502,
        "execution_unknown",
        "Salesforce did not establish the write outcome. Reconcile this workflow; do not retry.",
      );
    if (!write && (response.status >= 500 || response.status === 408 || response.status === 429))
      throw new HttpError(
        502,
        "provider_unavailable",
        "Salesforce could not complete this read. Check the connection or rate limit before trying again.",
      );
    if (!response.ok)
      throw new HttpError(
        response.status === 401 ? 401 : response.status === 412 ? 409 : 502,
        response.status === 401
          ? "provider_expired"
          : response.status === 412
            ? "provider_stale"
            : "provider_rejected",
        response.status === 401
          ? "Salesforce authorization expired. Reconnect this org."
          : response.status === 412
            ? "Salesforce changed during review. Prepare a fresh proposal."
            : "Salesforce rejected the operation. Check required permissions and provider constraints.",
      );
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (error) {
    // A truncated success response cannot establish whether a dispatched write succeeded.
    if (error instanceof HttpError && (!write || error.code !== "provider_bound")) throw error;
    throw new HttpError(
      502,
      write ? "execution_unknown" : "provider_unavailable",
      write
        ? "The Salesforce outcome is uncertain. Reconcile it before further changes."
        : "Salesforce is unavailable. Check the connection and try the read again.",
    );
  }
}
