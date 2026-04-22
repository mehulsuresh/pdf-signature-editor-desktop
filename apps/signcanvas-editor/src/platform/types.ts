import type { SignatureAssetStore } from "../types/editor";

export interface FilePayload {
  name: string;
  bytes: Uint8Array;
}

export interface PlatformBridge {
  openPdf(): Promise<FilePayload>;
  savePdf(name: string, bytes: Uint8Array): Promise<void>;
  importImage(): Promise<FilePayload>;
  loadAssets(): Promise<SignatureAssetStore>;
  saveAssets(store: SignatureAssetStore): Promise<void>;
  downloadBlob(name: string, mime: string, bytes: Uint8Array): Promise<void>;
}
