import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import { isElectron } from "./env";
import { syncDocumentElectronPlatformClasses } from "./lib/windowControlsOverlay";

async function startHeadful() {
  syncDocumentElectronPlatformClasses(navigator.platform);
  const { HeadfulShell } = await import("./headful/HeadfulShell");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <HeadfulShell />
    </React.StrictMode>,
  );
}

// Headful composes Salesforce setup, org-pinned admin tools and settings. Isolated experience
// previews (`?experience=<id>`) are available to browsers in development builds only.
export const startup =
  isElectron || (import.meta.env.DEV && new URLSearchParams(location.search).has("experience"))
    ? startHeadful()
    : import("./upstreamStartup").then(({ startup }) => startup);
