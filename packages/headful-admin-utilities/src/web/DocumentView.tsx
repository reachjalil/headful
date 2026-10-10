import { lazy, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { CodeEditor } from "./CodeEditor";
import { LazySurface } from "./LazySurface";
import { PaneDivider } from "./PaneDivider";
import { PanelTabs, panelTabId } from "./PanelTabs";
import { DockTargets, useCompactPanels } from "./PanelLayout";

const Preview = lazy(() =>
  import("./DocumentPreview").then((module) => ({ default: module.DocumentPreview })),
);
type Mode = "source" | "split" | "preview";

/** Host-rendered documents do not load images, activate links or execute embedded source. */
export function DocumentView({
  title,
  markdown,
  testId = "editor-document",
}: {
  title: string;
  markdown: string;
  testId?: string;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [sourceOpened, setSourceOpened] = useState(false);
  const [sourceWidth, setSourceWidth] = useState(50);
  const [sourceHeight, setSourceHeight] = useState(50);
  const [sourceFirst, setSourceFirst] = useState(true);
  const [dragging, setDragging] = useState<"source" | "preview" | null>(null);
  const dragOriginMode = useRef<Mode | null>(null);
  const [tabsRevision, setTabsRevision] = useState(0);
  const layoutMenu = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const compact = useCompactPanels();
  const source = markdown.slice(0, 100000);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !layoutMenu.current?.contains(event.target))
        layoutMenu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const split = (first: boolean) => {
    setSourceOpened(true);
    setMode("split");
    setSourceFirst(first);
    layoutMenu.current?.removeAttribute("open");
  };
  return (
    <section className="hf-document" aria-label={`${title} document`}>
      <div className="hf-document-toolbar">
        <span>Document</span>
        <PanelTabs
          key={tabsRevision}
          idPrefix={id}
          label="Document view"
          value={mode}
          items={(["source", "split", "preview"] as const).map((value) => ({
            id: value,
            label: value === "source" ? "Source" : value === "split" ? "Split" : "Preview",
            panelId: `${id}-panel`,
            testId: `${testId}-${value}`,
          }))}
          onChange={(value) => {
            if (value !== "preview") setSourceOpened(true);
            setMode(value as Mode);
          }}
          onDragOut={(value) => {
            if (value !== "source" && value !== "preview") return;
            dragOriginMode.current = mode;
            setDragging(value);
            setSourceOpened(true);
            setMode("split");
          }}
          onDragFinish={() => {
            if (dragOriginMode.current) setMode(dragOriginMode.current);
            dragOriginMode.current = null;
            setDragging(null);
          }}
        />
        <small>Markdown · Read only</small>
        <details
          className="hf-query-view-menu hf-document-layout-menu"
          ref={layoutMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              layoutMenu.current?.removeAttribute("open");
              layoutMenu.current?.querySelector("summary")?.focus();
            }
          }}
        >
          <summary data-testid={`${testId}-layout`}>Layout ▾</summary>
          <div className="hf-query-view-options">
            <button
              className="hf-button"
              type="button"
              data-testid={`${testId}-source-first`}
              aria-pressed={sourceFirst && mode === "split"}
              onClick={() => {
                split(true);
                layoutMenu.current?.querySelector("summary")?.focus();
              }}
            >
              Source first
            </button>
            <button
              className="hf-button"
              type="button"
              data-testid={`${testId}-preview-first`}
              aria-pressed={!sourceFirst && mode === "split"}
              onClick={() => {
                split(false);
                layoutMenu.current?.querySelector("summary")?.focus();
              }}
            >
              Preview first
            </button>
            <button
              className="hf-button"
              type="button"
              data-testid={`${testId}-layout-reset`}
              onClick={() => {
                setSourceWidth(50);
                setSourceHeight(50);
                setTabsRevision((revision) => revision + 1);
                split(true);
                layoutMenu.current?.querySelector("summary")?.focus();
              }}
            >
              Reset split layout
            </button>
          </div>
        </details>
      </div>
      {source.length < markdown.length && (
        <p className="hf-note" role="status">
          Document preview limited to 100,000 characters.
        </p>
      )}
      <div
        className={`hf-document-panes hf-document-${mode}`}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={panelTabId(id, mode)}
        data-source-first={sourceFirst}
        style={{ "--hf-source-size": `${compact ? sourceHeight : sourceWidth}%` } as CSSProperties}
      >
        <div className="hf-document-source" hidden={mode === "preview"}>
          {sourceOpened && (
            <CodeEditor
              value={source}
              language="markdown"
              readOnly
              label={`${title} source`}
              testId={`${testId}-source-editor`}
            />
          )}
        </div>
        <PaneDivider
          label={`Document source ${compact ? "height" : "width"}`}
          value={compact ? sourceHeight : sourceWidth}
          min={25}
          max={75}
          initial={50}
          onChange={compact ? setSourceHeight : setSourceWidth}
          edge={sourceFirst ? "start" : "end"}
          orientation={compact ? "horizontal" : "vertical"}
          hidden={mode !== "split"}
          testId={`${testId}-divider`}
        />
        <article
          className="hf-document-preview"
          aria-label={title}
          hidden={mode === "source"}
          tabIndex={0}
        >
          <LazySurface label={`${title} preview`}>
            <Preview source={source} />
          </LazySurface>
        </article>
        <DockTargets
          active={dragging !== null}
          label={dragging === "source" ? "Source" : "Preview"}
          edges={["left", "right"]}
          testId={`${testId}-dock`}
          onDock={(edge) => {
            if (!dragging) return;
            split(dragging === "source" ? edge === "left" : edge === "right");
            dragOriginMode.current = null;
            setDragging(null);
          }}
        />
      </div>
    </section>
  );
}
