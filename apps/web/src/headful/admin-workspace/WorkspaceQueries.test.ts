import { expect, it, vi } from "vite-plus/test";
import { createWorkspaceQueries, readWorkspaceMetadata } from "./WorkspaceQueries";

it("shares concurrent metadata and reuses the same exact object, without mixing inputs or workspaces", async () => {
  const a = createWorkspaceQueries(),
    b = createWorkspaceQueries();
  let finish!: (value: { fields: string[] }) => void;
  const read = vi.fn(
    () =>
      new Promise<{ fields: string[] }>((resolve) => {
        finish = resolve;
      }),
  );
  const input = { orgId: "a", object: "Account" };
  try {
    const first = readWorkspaceMetadata(a, "utilities.objects.describe", input, read);
    const second = readWorkspaceMetadata(a, "utilities.objects.describe", input, read);
    expect(read).toHaveBeenCalledTimes(1);
    finish({ fields: ["Name"] });
    expect(await first).toEqual(await second);
    await readWorkspaceMetadata(a, "utilities.objects.describe", input, read);
    expect(read).toHaveBeenCalledTimes(1);
    const other = vi.fn(async () => ({ fields: ["Industry"] }));
    await readWorkspaceMetadata(
      a,
      "utilities.objects.describe",
      { ...input, object: "Contact" },
      other,
    );
    await readWorkspaceMetadata(b, "utilities.objects.describe", input, other);
    expect(other).toHaveBeenCalledTimes(2);
    await a.invalidateQueries({ refetchType: "none" });
    await readWorkspaceMetadata(a, "utilities.objects.describe", input, other);
    expect(other).toHaveBeenCalledTimes(3);
  } finally {
    a.clear();
    b.clear();
  }
});

it("never caches query execution, records, writes or failed reads and never retries a failure", async () => {
  const client = createWorkspaceQueries();
  try {
    for (const operation of [
      "utilities.query.run",
      "utilities.record.get",
      "utilities.favorites.remove",
      "mods.command",
    ]) {
      const read = vi.fn(async () => ({ value: "receipt" }));
      await readWorkspaceMetadata(client, operation, { orgId: "a" }, read);
      await readWorkspaceMetadata(client, operation, { orgId: "a" }, read);
      expect(read).toHaveBeenCalledTimes(2);
    }
    const failed = vi.fn(async () => {
      throw Error("Access revoked");
    });
    await expect(
      readWorkspaceMetadata(client, "utilities.objects.list", { orgId: "a" }, failed),
    ).rejects.toThrow("Access revoked");
    expect(failed).toHaveBeenCalledTimes(1);
    await expect(
      readWorkspaceMetadata(client, "utilities.objects.list", { orgId: "a" }, failed),
    ).rejects.toThrow("Access revoked");
    expect(failed).toHaveBeenCalledTimes(2);
  } finally {
    client.clear();
  }
});

it("rejects a pending cache consumer when authority clears, and bounds completed metadata entries", async () => {
  const client = createWorkspaceQueries();
  let finish!: (value: string) => void;
  try {
    const pending = readWorkspaceMetadata(
      client,
      "utilities.objects.describe",
      { orgId: "a", object: "Account" },
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const rejection = expect(pending).rejects.toBeDefined();
    client.clear();
    finish("old authority");
    await rejection;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    for (let i = 0; i < 55; i++)
      await readWorkspaceMetadata(
        client,
        "utilities.objects.describe",
        { orgId: "a", object: `Object${i}` },
        async () => i,
      );
    expect(client.getQueryCache().getAll()).toHaveLength(50);
  } finally {
    client.clear();
  }
});
