import { useCallback, useRef, useState, type ReactNode } from "react";
import type { UtilityComponentProps } from "./types";

export function useUtilityTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const run = useCallback(async <T,>(task: () => Promise<T>, success: (value: T) => void) => {
    const current = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const value = await task();
      if (revision.current === current) success(value);
    } catch (caught) {
      if (revision.current === current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not read this org. Check the connection in Your orgs, then retry the read.",
        );
    } finally {
      if (revision.current === current) setBusy(false);
    }
  }, []);
  const reset = useCallback(() => {
    revision.current++;
    setBusy(false);
    setError("");
  }, []);
  return { busy, error, run, reset };
}

export function UtilityPanel({
  title,
  description,
  actions,
  children,
  busy,
  error,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  error?: string;
}) {
  return (
    <section className="hf-utility-panel" aria-busy={busy || false}>
      <div className="hf-utility-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="hf-actions">{actions}</div>}
      </div>
      {error && (
        <div className="hf-alert" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <p className="hf-progress" role="status">
          Reading from the selected org…
        </p>
      )}
      {children}
    </section>
  );
}

export function OrgRequired({
  props,
  children,
}: {
  props: UtilityComponentProps;
  children: ReactNode;
}) {
  if (!props.orgId || !props.orgs.some((org) => org.id === props.orgId))
    return (
      <div className="hf-empty">
        <h2>Choose a connected org.</h2>
        <p>Use the target selector above or connect an org from Your orgs.</p>
      </div>
    );
  return <>{children}</>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="hf-utility-empty">{children}</div>;
}
