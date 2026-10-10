import { useState, useSyncExternalStore } from "react";

const compactQuery = "(max-width: 680px)";
const compactSnapshot = () =>
  typeof window.matchMedia === "function" && window.matchMedia(compactQuery).matches;
const compactSubscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
export const useCompactPanels = () =>
  useSyncExternalStore(compactSubscribe, compactSnapshot, () => false);
export type DockEdge = "left" | "right" | "bottom";

const defaultEdges: readonly DockEdge[] = ["left", "right", "bottom"];

/** Only a drag started by the local panel tabs reveals these targets; files/URLs are never read. */
export function DockTargets({
  active,
  label,
  testId,
  edges = defaultEdges,
  onDock,
}: {
  active: boolean;
  label: string;
  testId: string;
  edges?: readonly DockEdge[];
  onDock: (edge: DockEdge) => void;
}) {
  const [over, setOver] = useState<DockEdge | null>(null);
  return (
    <div className="hf-dock-targets" role="group" aria-label="Panel drop targets" hidden={!active}>
      {edges.map((edge) => (
        <button
          className={`hf-dock-target hf-dock-${edge}`}
          type="button"
          key={edge}
          data-testid={`${testId}-${edge}`}
          data-over={over === edge || undefined}
          onClick={() => {
            if (active) onDock(edge);
          }}
          onDragOver={(event) => {
            if (!active) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(edge);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            if (!active) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(null);
            onDock(edge);
          }}
        >
          <span aria-hidden="true">{edge === "left" ? "←" : edge === "right" ? "→" : "↓"}</span>
          {label} · {edge === "bottom" ? "Below" : edge === "left" ? "Left" : "Right"}
        </button>
      ))}
    </div>
  );
}
