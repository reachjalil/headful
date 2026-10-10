import { ipcRenderer } from "electron";
// This isolated, sandboxed preload transfers only the host-owned MessagePort.
// It exposes no Electron API, dispatch function, native object, token or identity input.
ipcRenderer.once("headful-mod:port", (event) => {
  if (event.ports.length !== 1) return;
  window.postMessage("headful-mod:port", "*", [event.ports[0]!]);
});
