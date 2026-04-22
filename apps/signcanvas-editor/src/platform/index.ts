import type { PlatformBridge } from "./types";
import { tauriBridge } from "./tauri";
import { webBridge } from "./web";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function getPlatformBridge(): PlatformBridge {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return tauriBridge;
  }
  return webBridge;
}
