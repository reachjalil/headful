import { useEffect, useRef, useState, type ReactNode } from "react";

export const panelTabId = (prefix: string, value: string) =>
  `${prefix}-tab-${encodeURIComponent(value)}`;

/** Tabs reorder locally; selecting or moving them never recreates the content panel. */
export function PanelTabs({
  idPrefix,
  label,
  items,
  value,
  onChange,
  onIntent,
  onDragOut,
  onDragFinish,
}: {
  idPrefix: string;
  label: string;
  items: readonly {
    id: string;
    label: string;
    icon?: ReactNode;
    panelId: string;
    testId: string;
    disabled?: boolean;
  }[];
  value: string;
  onChange: (id: string) => void;
  onIntent?: (id: string) => void;
  onDragOut?: (id: string) => void;
  onDragFinish?: () => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [focus, setFocus] = useState<{ value: string; id: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragged = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const ordered = [
    ...order.flatMap((id) => items.filter((item) => item.id === id)),
    ...items.filter((item) => !order.includes(item.id)),
  ];
  const enabled = ordered.filter((item) => !item.disabled);
  useEffect(() => {
    const reveal = () => {
      const focused = document.activeElement;
      const target =
        focused instanceof HTMLElement && list.current?.contains(focused)
          ? focused
          : buttons.current.get(value);
      target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    reveal();
    if (typeof ResizeObserver === "undefined" || !list.current) return;
    const observer = new ResizeObserver(reveal);
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [value]);
  const focusId =
    focus?.value === value && enabled.some((item) => item.id === focus.id)
      ? focus.id
      : (enabled.find((item) => item.id === value)?.id ?? enabled[0]?.id);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setContext(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const focusTab = (id: string) => {
    setFocus({ value, id });
    buttons.current.get(id)?.focus();
    buttons.current.get(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const move = (id: string, target: string, after: boolean) => {
    if (
      id === target ||
      !ordered.some((item) => item.id === id) ||
      !ordered.some((item) => item.id === target)
    )
      return;
    const next = ordered.map((item) => item.id).filter((key) => key !== id);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, id);
    setOrder(next);
    setAnnouncement(
      `${items.find((item) => item.id === id)?.label} moved to position ${next.indexOf(id) + 1} of ${next.length}.`,
    );
  };
  const moveBy = (id: string, direction: number) => {
    const index = ordered.findIndex((item) => item.id === id);
    const target = ordered[index + direction];
    if (target) move(id, target.id, direction > 0);
  };
  const finish = () => {
    dragged.current = null;
    setDragging(null);
    setDrop(null);
    onDragFinish?.();
  };
  const openContext = (id: string) => {
    setContext(id);
    requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus(),
    );
  };
  const closeContext = () => {
    setContext(null);
    if (context) focusTab(context);
  };
  return (
    <div className="hf-tab-group">
      <div
        className="hf-panel-tabs"
        ref={list}
        role="tablist"
        aria-label={label}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setFocus(null);
        }}
      >
        {ordered.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={panelTabId(idPrefix, item.id)}
            data-testid={item.testId}
            aria-controls={item.panelId}
            aria-selected={item.id === value}
            aria-current={item.id === value ? "page" : undefined}
            aria-description="Drag to reorder. Arrow keys move focus; Enter activates. Alt and arrow keys reorder, Alt Home resets order. Right-click or Shift F10 opens tab options."
            tabIndex={item.id === focusId ? 0 : -1}
            disabled={item.disabled}
            draggable={!item.disabled}
            data-dragging={dragging === item.id || undefined}
            data-drop={drop?.id === item.id ? (drop.after ? "after" : "before") : undefined}
            ref={(element) => {
              if (element) buttons.current.set(item.id, element);
              else buttons.current.delete(item.id);
            }}
            onClick={() => {
              setFocus({ value: item.id, id: item.id });
              onChange(item.id);
            }}
            onFocus={() => {
              setFocus({ value, id: item.id });
              onIntent?.(item.id);
            }}
            onPointerEnter={() => onIntent?.(item.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              openContext(item.id);
            }}
            onKeyDown={(event) => {
              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                event.preventDefault();
                openContext(item.id);
                return;
              }
              if (event.key === "Escape" && dragged.current) {
                event.preventDefault();
                finish();
                return;
              }
              if (event.altKey && event.key === "Home") {
                event.preventDefault();
                setOrder([]);
                setAnnouncement("Default tab order restored.");
                return;
              }
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                moveBy(item.id, event.key === "ArrowLeft" ? -1 : 1);
                return;
              }
              const index = enabled.findIndex((tab) => tab.id === item.id);
              const next =
                event.key === "Home"
                  ? enabled[0]
                  : event.key === "End"
                    ? enabled.at(-1)
                    : enabled[
                        (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) %
                          enabled.length
                      ];
              if (next) focusTab(next.id);
            }}
            onDragStart={(event) => {
              dragged.current = item.id;
              setDragging(item.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/x-headful-panel-tab",
                `${idPrefix}:${item.id}`,
              );
              onDragOut?.(item.id);
            }}
            onDragOver={(event) => {
              if (!dragged.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              const after = event.clientX > bounds.left + bounds.width / 2;
              setDrop((current) =>
                current?.id === item.id && current.after === after
                  ? current
                  : { id: item.id, after },
              );
            }}
            onDragLeave={() => setDrop((current) => (current?.id === item.id ? null : current))}
            onDrop={(event) => {
              if (!dragged.current) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              move(dragged.current, item.id, event.clientX > bounds.left + bounds.width / 2);
              finish();
            }}
            onDragEnd={finish}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      {context && (
        <div
          className="hf-tab-menu"
          ref={menu}
          role="group"
          aria-label="Tab options"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeContext();
            }
            if (event.key === "Tab") setContext(null);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const options = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
              ];
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              options[
                (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
              ]?.focus();
            }
          }}
        >
          <strong>{items.find((item) => item.id === context)?.label}</strong>
          <button
            type="button"
            disabled={ordered[0]?.id === context}
            onClick={() => {
              moveBy(context, -1);
              closeContext();
            }}
          >
            Move tab left
          </button>
          <button
            type="button"
            disabled={ordered.at(-1)?.id === context}
            onClick={() => {
              moveBy(context, 1);
              closeContext();
            }}
          >
            Move tab right
          </button>
          <button
            type="button"
            onClick={() => {
              setOrder([]);
              setAnnouncement("Default tab order restored.");
              closeContext();
            }}
          >
            Reset tab order
          </button>
        </div>
      )}
      <span
        className="hf-visually-hidden"
        role={announcement ? "status" : undefined}
        aria-live="polite"
      >
        {announcement}
      </span>
    </div>
  );
}
