/* oxlint-disable shadcn/no-unknown-classes -- Settings owns its scoped surface. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

const DisclosureState = createContext<{
  scope: string;
  expanded: ReadonlyMap<string, boolean>;
  setExpanded: (key: string, open: boolean) => void;
} | null>(null);

/** Remember disclosure choices by exact connection and topic, without mounting hidden reads. */
export function SettingsDisclosureScope({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [expanded, update] = useState<ReadonlyMap<string, boolean>>(new Map());
  const setExpanded = useCallback((key: string, open: boolean) => {
    update((previous) => {
      if ((previous.get(key) ?? false) === open) return previous;
      const next = new Map(previous);
      next.delete(key);
      next.set(key, open);
      if (next.size > 200) next.delete(next.keys().next().value!);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ scope, expanded, setExpanded }), [scope, expanded, setExpanded]);
  return <DisclosureState.Provider value={value}>{children}</DisclosureState.Provider>;
}

export function SettingsDisclosure({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  const state = useContext(DisclosureState);
  const [localOpen, setLocalOpen] = useState(false);
  const key = `${state?.scope ?? "standalone"}:${id}`;
  const open = state ? (state.expanded.get(key) ?? false) : localOpen;
  return (
    <Collapsible.Root
      className="os-disclosure"
      data-testid={`settings-disclosure-${id}`}
      open={open}
      onOpenChange={(next) => {
        if (next === open) return;
        if (state) state.setExpanded(key, next);
        else setLocalOpen(next);
      }}
    >
      <Collapsible.Trigger
        className="os-disclosure-trigger"
        data-testid={`settings-disclosure-${id}-toggle`}
      >
        <ChevronRight size={14} aria-hidden="true" />
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="os-disclosure-body">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
