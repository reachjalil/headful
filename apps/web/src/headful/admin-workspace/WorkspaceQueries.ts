import { QueryClient } from "@tanstack/react-query";

export function createWorkspaceQueries() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        networkMode: "always",
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

/** Only bounded metadata is reusable. Query execution, records, receipts and writes always dispatch. */
export function readWorkspaceMetadata<T>(
  client: QueryClient,
  operation: string,
  input: unknown,
  read: () => Promise<T>,
) {
  if (!["utilities.objects.list", "utilities.objects.describe"].includes(operation)) return read();
  // Bound describe reuse across a long-lived editor. In-flight reads remain shared.
  const cached = client.getQueryCache().findAll({ queryKey: ["utility-metadata"] });
  if (cached.length >= 50) {
    const oldest = cached
      .filter((query) => query.state.fetchStatus !== "fetching")
      .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)[0];
    if (oldest) client.removeQueries({ queryKey: oldest.queryKey, exact: true });
  }
  return client.fetchQuery({
    queryKey: ["utility-metadata", operation, input],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const value = await read();
      // Clearing authority cancels cache consumers, not an already accepted native request.
      signal.throwIfAborted();
      return value;
    },
  });
}
