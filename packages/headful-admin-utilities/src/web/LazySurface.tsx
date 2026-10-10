import { Component, Suspense, type ReactNode } from "react";

class LoadError extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div className="hf-lazy-message" role="alert">
        Could not load {this.props.label}.
        <button type="button" onClick={() => window.location.reload()}>
          Reload window
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

/** Keep navigation usable while one selected surface loads. No automatic chunk retries. */
export function LazySurface({ label, children }: { label: string; children: ReactNode }) {
  return (
    <LoadError label={label}>
      <Suspense
        fallback={
          <div className="hf-lazy-message" role="status" aria-busy="true">
            Opening {label}…
          </div>
        }
      >
        {children}
      </Suspense>
    </LoadError>
  );
}
