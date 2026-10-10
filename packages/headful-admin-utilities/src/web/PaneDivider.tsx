import { useEffect, useRef, useState } from "react";

/** Bounded local geometry. Pointer changes are coalesced to one render per frame. */
export function PaneDivider({
  label,
  value,
  min,
  max,
  initial,
  onChange,
  edge = "start",
  orientation = "vertical",
  hidden = false,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  initial: number;
  onChange: (value: number) => void;
  edge?: "start" | "end";
  orientation?: "vertical" | "horizontal";
  hidden?: boolean;
  testId: string;
}) {
  const drag = useRef<{ id: number; origin: number; value: number; size: number } | null>(null);
  const animation = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const direction = edge === "end" ? -1 : 1;
  const horizontal = orientation === "horizontal";
  const bounded = (next: number) => Math.max(min, Math.min(max, Math.round(next * 10) / 10));
  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
    },
    [],
  );
  const clearFrame = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  const flush = () => {
    if (pending.current !== null) onChange(pending.current);
    pending.current = null;
  };
  const finish = (cancel: boolean) => {
    clearFrame();
    if (cancel && drag.current) {
      pending.current = null;
      onChange(drag.current.value);
    } else flush();
    drag.current = null;
    setResizing(false);
  };
  const coordinate = (x: number, y: number) => (horizontal ? y : x);
  return (
    <div
      className="hf-pane-divider"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value}% of workspace ${horizontal ? "height" : "width"}`}
      aria-description="Drag to resize. Escape cancels a drag. Arrow keys adjust, Shift moves in larger steps, Home and End select the limits. Double-click resets."
      data-testid={testId}
      data-resizing={resizing || undefined}
      hidden={hidden}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          const pointer = drag.current.id;
          finish(true);
          if (event.currentTarget.hasPointerCapture(pointer))
            event.currentTarget.releasePointerCapture(pointer);
          return;
        }
        const previous = horizontal ? "ArrowUp" : "ArrowLeft";
        const next = horizontal ? "ArrowDown" : "ArrowRight";
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onChange(event.key === "Home" ? min : max);
        } else if (event.key === previous || event.key === next) {
          event.preventDefault();
          onChange(
            bounded(value + (event.key === next ? 1 : -1) * direction * (event.shiftKey ? 5 : 1)),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        const size = horizontal ? bounds?.height : bounds?.width;
        if (!size) return;
        drag.current = {
          id: event.pointerId,
          origin: coordinate(event.clientX, event.clientY),
          value,
          size,
        };
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.id !== event.pointerId) return;
        pending.current = bounded(
          current.value +
            ((coordinate(event.clientX, event.clientY) - current.origin) / current.size) *
              100 *
              direction,
        );
        if (animation.current === null)
          animation.current = requestAnimationFrame(() => {
            animation.current = null;
            flush();
          });
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        finish(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => {
        if (drag.current) finish(false);
      }}
    />
  );
}
