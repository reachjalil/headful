import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { salesforceJson } from "./SalesforceHttp.ts";
import { directRequest, verifiedOrgSession, withVerifiedRead } from "./OrgService.ts";
import { CliAdapter } from "./SalesforceCli.ts";

const identity = {
  orgId: "00D000000000001",
  userId: "005000000000001",
  username: "fictional@example.com",
  instanceOrigin: "https://fixture.my.salesforce.com",
  accessToken: "fixture-private-token",
};
const org = {
  salesforce_org_id: identity.orgId,
  salesforce_user_id: identity.userId,
  username: identity.username,
  instance_origin: identity.instanceOrigin,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native Salesforce HTTP contract", () => {
  it("closes a verified read scope after completion and refuses unsafe resources within it", async () => {
    const cli = new CliAdapter();
    vi.spyOn(cli, "session").mockResolvedValue(identity);
    const fetch = vi.fn(async () => Response.json({ value: 1 }));
    vi.stubGlobal("fetch", fetch);
    let savedRead!: (path: string) => Promise<unknown>;
    await withVerifiedRead(cli, org, async (read) => {
      savedRead = read;
      expect(await read("/services/data/v67.0/limits")).toEqual({ value: 1 });
      await expect(
        read("/services/data/v67.0/tooling/executeAnonymous/?anonymousBody=x"),
      ).rejects.toMatchObject({ code: "provider_path" });
    });
    await expect(savedRead("/services/data/v67.0/limits")).rejects.toMatchObject({
      code: "provider_cancelled",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { "If-Unmodified-Since": "Wed, 07 Oct 2026 10:00:00 GMT", Authorization: "wrong" },
    new Headers({ "If-Unmodified-Since": "Wed, 07 Oct 2026 10:00:00 GMT", Authorization: "wrong" }),
    [
      ["If-Unmodified-Since", "Wed, 07 Oct 2026 10:00:00 GMT"],
      ["Authorization", "wrong"],
    ] as [string, string][],
  ])(
    "preserves conditional write headers and runtime-owned authorization (%#)",
    async (headers) => {
      const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const sent = new Headers(init.headers);
        expect(sent.get("authorization")).toBe("Bearer fixture-private-token");
        expect(sent.get("if-unmodified-since")).toBe("Wed, 07 Oct 2026 10:00:00 GMT");
        expect(sent.get("accept")).toBe("application/json");
        expect(sent.get("content-type")).toBe("application/json");
        expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal("fetch", fetch);
      expect(
        await salesforceJson(
          identity.instanceOrigin + "/services/data/v67.0/sobjects/User/005000000000001",
          identity.accessToken,
          { method: "PATCH", headers, body: "{}" },
          true,
        ),
      ).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["caller", "deadline"])(
    "cancels a body read on %s abort and never retries a dispatched write",
    async (source) => {
      const controller = new AbortController();
      const deadline = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      let reading!: () => void;
      const ready = new Promise<void>((resolve) => {
        reading = resolve;
      });
      const cancelled = vi.fn();
      const fetch = vi.fn(
        async (_url: string, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(stream) {
                init.signal!.addEventListener("abort", () => stream.error(init.signal!.reason), {
                  once: true,
                });
              },
              pull() {
                reading();
              },
              cancel: cancelled,
            }),
          ),
      );
      vi.stubGlobal("fetch", fetch);
      const request = salesforceJson(
        identity.instanceOrigin,
        identity.accessToken,
        { method: "PATCH", body: "{}", signal: controller.signal },
        true,
      );
      const rejected = expect(request).rejects.toMatchObject({ code: "execution_unknown" });
      await ready;
      (source === "caller" ? controller : deadline).abort();
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "cancels oversized response streams and classifies uncertainty (write=%s)",
    async (write) => {
      const cancelled = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(stream) {
                  stream.enqueue(new Uint8Array(5));
                },
                cancel: cancelled,
              }),
            ),
        ),
      );
      await expect(
        salesforceJson(identity.instanceOrigin, identity.accessToken, {}, write, 4),
      ).rejects.toMatchObject({ code: write ? "execution_unknown" : "provider_bound" });
      expect(cancelled).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels an unread body when content-length exceeds the limit", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel: cancelled }), {
            headers: { "content-length": "5" },
          }),
      ),
    );
    await expect(
      salesforceJson(identity.instanceOrigin, identity.accessToken, {}, true, 4),
    ).rejects.toMatchObject({ code: "execution_unknown" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each([
    [412, "provider_stale"],
    [401, "provider_expired"],
    [408, "execution_unknown"],
    [500, "execution_unknown"],
  ])("maps write response %s without retrying", async (status, code) => {
    const fetch = vi.fn(async () => new Response(null, { status: Number(status) }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      salesforceJson(identity.instanceOrigin, identity.accessToken, {}, true),
    ).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503])("fails read response %s without retrying", async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      salesforceJson(identity.instanceOrigin, identity.accessToken),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses unreviewed methods, unsafe paths and cancelled work before obtaining credentials", async () => {
    const cli = new CliAdapter();
    const session = vi.spyOn(cli, "session").mockResolvedValue(identity);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const path of [
      "/services/data/v67.0/../query",
      "/services/data/v67.0//query",
      "/services/data/v67.0/tooling/executeAnonymous/?anonymousBody=x",
      "/services/data/v67.0/query#fragment",
      "/services/data/v67.0/query\r\nX: y",
    ])
      await expect(directRequest(cli, org, path)).rejects.toMatchObject({ code: "provider_path" });
    await expect(
      directRequest(cli, org, "/services/data/v67.0/sobjects/User", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "provider_method" });
    await expect(
      directRequest(cli, org, "/services/data/v67.0/limits", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "provider_cancelled" });
    expect(session).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares only concurrent read identity resolution, with fresh write verification and no completed cache", async () => {
    const cli = new CliAdapter();
    let resolve!: (value: typeof identity) => void;
    const session = vi.spyOn(cli, "session").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = verifiedOrgSession(cli, org);
    const second = verifiedOrgSession(cli, org);
    expect(session).toHaveBeenCalledTimes(1);
    session.mockResolvedValue(identity);
    await verifiedOrgSession(cli, org, true);
    expect(session).toHaveBeenCalledTimes(2);
    resolve(identity);
    await Promise.all([first, second]);
    await verifiedOrgSession(cli, org);
    expect(session).toHaveBeenCalledTimes(3);
    session.mockResolvedValue({ ...identity, userId: "005000000000002" });
    await expect(directRequest(cli, org, "/services/data/v67.0/limits")).rejects.toMatchObject({
      code: "connection_changed",
    });
  });

  it("clears a failed identity lookup so an explicit later read can recheck", async () => {
    const cli = new CliAdapter();
    const session = vi
      .spyOn(cli, "session")
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(identity);
    await expect(verifiedOrgSession(cli, org)).rejects.toThrow("unavailable");
    expect(await verifiedOrgSession(cli, org)).toMatchObject(identity);
    expect(session).toHaveBeenCalledTimes(2);
  });
});
