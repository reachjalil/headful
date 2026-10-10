/* oxlint-disable shadcn/no-unknown-classes -- Headful mod views share the editor's scoped stylesheet. */
import { useQuery } from "@tanstack/react-query";
import { DocumentView } from "@headfulcloud/admin-utilities/web";
import { modSurfaceResultSchema } from "@t3tools/contracts/headful-mods";
import type { SetupDispatch } from "../setup-service";
import type { EditorTool } from "./editor-contributions";

export function EditorModView({ tool, dispatch }: { tool: EditorTool; dispatch: SetupDispatch }) {
  const view = useQuery({
    queryKey: ["mod-document", tool.modId, tool.revision, tool.contribution.surfaceId],
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const value = await dispatch("mods.surface", {
        id: tool.modId,
        surfaceId: tool.contribution.surfaceId!,
        artifactRevision: tool.revision,
      });
      signal.throwIfAborted();
      return modSurfaceResultSchema.parse(value);
    },
  });
  const result = view.data;
  const busy = view.isFetching;
  const error = view.error?.message;
  return (
    <section className="sf-editor-mod-view" aria-busy={busy} aria-label={tool.contribution.name}>
      <div className="sf-editor-mod-heading">
        <nav aria-label="Breadcrumb">
          <ol>
            <li>Workspace</li>
            <li aria-current="page">
              <h1>{tool.contribution.name}</h1>
            </li>
          </ol>
        </nav>
        <span>{tool.ownerName}</span>
        <button
          className="hf-button"
          data-testid="editor-refresh-view"
          disabled={busy}
          onClick={() => void view.refetch()}
        >
          Refresh view
        </button>
      </div>
      {busy && <p role="status">Opening {tool.contribution.name}…</p>}
      {error && <p role="alert">{error} Use Refresh view to try again.</p>}
      {result && <DocumentView title={result.title} markdown={result.markdown} />}
    </section>
  );
}
