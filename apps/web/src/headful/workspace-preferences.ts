export interface HeaderLayout {
  order: string[];
  hidden: string[];
}

/** Resolve known optional controls only. The required target-org selector is never in this list. */
export function resolveHeaderControls<
  T extends { id: string; order: number; defaultVisible: boolean },
>(controls: readonly T[], layout?: HeaderLayout): Array<T & { visible: boolean }> {
  const known = new Map(controls.map((control) => [control.id, control]));
  const defaults = [...controls].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const order = [...new Set([...(layout?.order ?? []), ...defaults.map((item) => item.id)])];
  const hidden = new Set(layout?.hidden ?? []);
  const customized = Boolean(layout && (layout.order.length > 0 || layout.hidden.length > 0));
  return order.flatMap((id) => {
    const control = known.get(id);
    return control
      ? [{ ...control, visible: customized ? !hidden.has(id) : control.defaultVisible }]
      : [];
  });
}

export function moveHeaderControl(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const next = [...order];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
