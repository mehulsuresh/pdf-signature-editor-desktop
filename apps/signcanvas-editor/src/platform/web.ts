import localforage from "localforage";

import type { SignatureAssetStore } from "../types/editor";
import type { FilePayload, PlatformBridge } from "./types";

const EMPTY_ASSETS: SignatureAssetStore = {
  signature: [],
  initials: [],
};

const storage = localforage.createInstance({
  name: "signcanvas-editor",
  storeName: "assets",
});

function shouldOpenInNewTab(mime: string) {
  const userAgent = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isPdf = mime === "application/pdf";
  const isiOS = /iPhone|iPad|iPod/i.test(userAgent);

  // Mobile Safari still handles blob downloads inconsistently; opening the
  // generated PDF in a new tab lets the user preview, share, or save it.
  return isPdf && isMobile && isiOS;
}

async function readFileFromPicker(options: {
  accept: string;
  fallbackName: string;
}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = options.accept;
  input.style.display = "none";
  document.body.append(input);

  const file = await new Promise<File>((resolve, reject) => {
    input.onchange = () => {
      const selected = input.files?.[0];
      if (!selected) {
        reject(new Error("No file selected."));
        return;
      }
      resolve(selected);
    };
    input.click();
  }).finally(() => input.remove());

  return {
    name: file.name || options.fallbackName,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

export const webBridge: PlatformBridge = {
  openPdf() {
    return readFileFromPicker({
      accept: ".pdf,application/pdf",
      fallbackName: "document.pdf",
    });
  },
  async savePdf(name, bytes) {
    await this.downloadBlob(name, "application/pdf", bytes);
  },
  importImage() {
    return readFileFromPicker({
      accept: ".png,.jpg,.jpeg,.webp,.bmp,image/*",
      fallbackName: "signature.png",
    });
  },
  async loadAssets() {
    return (await storage.getItem<SignatureAssetStore>("signature-assets")) ?? EMPTY_ASSETS;
  },
  async saveAssets(store) {
    await storage.setItem("signature-assets", store);
  },
  async downloadBlob(name, mime, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    if (shouldOpenInNewTab(mime)) {
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
