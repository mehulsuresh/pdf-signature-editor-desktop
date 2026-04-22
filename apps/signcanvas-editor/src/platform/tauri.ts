import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

import type { SignatureAssetStore } from "../types/editor";
import type { FilePayload, PlatformBridge } from "./types";

const EMPTY_ASSETS: SignatureAssetStore = {
  signature: [],
  initials: [],
};

const ASSET_DIR = "signcanvas";
const ASSET_FILE = `${ASSET_DIR}/assets.json`;

function normalizeAssetStore(value: unknown): SignatureAssetStore {
  const maybe = value as Partial<SignatureAssetStore> | null | undefined;
  return {
    signature: Array.isArray(maybe?.signature) ? maybe.signature : [],
    initials: Array.isArray(maybe?.initials) ? maybe.initials : [],
  };
}

async function readNativeFile(path: string): Promise<FilePayload> {
  const bytes = await readFile(path);
  const name = path.split(/[\\/]/).pop() ?? "file";
  return { name, bytes };
}

async function ensureAssetDir() {
  const hasDir = await exists(ASSET_DIR, { baseDir: BaseDirectory.AppData });
  if (!hasDir) {
    await mkdir(ASSET_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

export const tauriBridge: PlatformBridge = {
  async openPdf() {
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path || Array.isArray(path)) {
      throw new Error("No file selected.");
    }
    return readNativeFile(path);
  },
  async savePdf(name, bytes) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) {
      return;
    }
    await writeFile(path, bytes);
  },
  async importImage() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (!path || Array.isArray(path)) {
      throw new Error("No file selected.");
    }
    return readNativeFile(path);
  },
  async loadAssets() {
    await ensureAssetDir();
    try {
      const hasFile = await exists(ASSET_FILE, { baseDir: BaseDirectory.AppData });
      if (!hasFile) {
        return EMPTY_ASSETS;
      }
      const raw = await readTextFile(ASSET_FILE, { baseDir: BaseDirectory.AppData });
      const parsed = normalizeAssetStore(JSON.parse(raw));
      return parsed;
    } catch {
      try {
        await writeTextFile(ASSET_FILE, JSON.stringify(EMPTY_ASSETS), {
          baseDir: BaseDirectory.AppData,
        });
      } catch {
        // If reset also fails, still return a safe empty store so startup stays clean.
      }
      return EMPTY_ASSETS;
    }
  },
  async saveAssets(store) {
    await ensureAssetDir();
    try {
      await writeTextFile(ASSET_FILE, JSON.stringify(normalizeAssetStore(store)), {
        baseDir: BaseDirectory.AppData,
      });
    } catch {
      throw new Error("Could not save local signatures.");
    }
  },
  async downloadBlob(name, mime, bytes) {
    await this.savePdf(name, bytes);
  },
};
