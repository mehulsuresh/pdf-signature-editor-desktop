import type { SignatureAsset, SignatureKind } from "../types/editor";
import { clamp, createId, dataUrlToBytes, hexToRgb } from "./utils";

export const SCRIPT_FONT_OPTIONS = [
  { label: "Great Vibes", value: "Great Vibes, cursive" },
  { label: "Allura", value: "Allura, cursive" },
  { label: "Alex Brush", value: "Alex Brush, cursive" },
] as const;

export async function loadImageFromBytes(bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    return await loadImageFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadImageFromUrl(url: string) {
  const image = new Image();
  image.decoding = "async";
  const ready = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
  });
  image.src = url;
  return ready;
}

export function trimTransparentCanvas(sourceCanvas: HTMLCanvasElement) {
  const context = sourceCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  const { width, height } = sourceCanvas;
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error("No visible signature detected.");
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = maxX - minX + 1;
  outCanvas.height = maxY - minY + 1;
  const outContext = outCanvas.getContext("2d");
  if (!outContext) {
    throw new Error("Canvas context unavailable.");
  }
  outContext.putImageData(
    context.getImageData(minX, minY, outCanvas.width, outCanvas.height),
    0,
    0,
  );
  return outCanvas;
}

export async function cleanupImportedSignature(
  bytes: Uint8Array,
  mimeType: string,
) {
  const image = await loadImageFromBytes(bytes, mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const minRgb = Math.min(red, green, blue);
    const darkness = 255 - minRgb;
    const alphaBase = darkness < 10 ? 0 : clamp((darkness - 10) * (255 / 90), 0, 255);
    const alpha = clamp((alphaBase - 128) * 1.45 + 128, 0, 255);

    const boost = (value: number) => clamp((value - 128) * 1.45 + 128, 0, 255) * 0.82;

    data[index] = clamp(boost(red), 0, 255);
    data[index + 1] = clamp(boost(green), 0, 255);
    data[index + 2] = clamp(boost(blue), 0, 255);
    data[index + 3] = alpha;
  }

  context.putImageData(imageData, 0, 0);
  const trimmed = trimTransparentCanvas(canvas);
  return {
    dataUrl: trimmed.toDataURL("image/png"),
    width: trimmed.width,
    height: trimmed.height,
  };
}

export function buildAssetLabel(kind: SignatureKind, existingCount: number, source: string) {
  if (source === "typed") {
    return kind === "signature" ? "Typed Signature" : "Typed Initials";
  }
  if (source === "imported") {
    return "Imported Signature";
  }
  const base = kind === "signature" ? "Signature" : "Initials";
  return `${base} ${existingCount + 1}`;
}

export function createAssetFromCanvas(
  kind: SignatureKind,
  canvas: HTMLCanvasElement,
  existingCount: number,
  source: SignatureAsset["source"],
): SignatureAsset {
  const trimmed = trimTransparentCanvas(canvas);
  return {
    id: createId(kind),
    kind,
    source,
    label: buildAssetLabel(kind, existingCount, source),
    imageDataUrl: trimmed.toDataURL("image/png"),
    inkPreviewColor: "#111111",
    width: trimmed.width,
    height: trimmed.height,
  };
}

export async function createTypedSignatureAsset(options: {
  kind: SignatureKind;
  text: string;
  fontFamily: string;
  fontSize: number;
  existingCount: number;
}) {
  if ("fonts" in document) {
    await document.fonts.load(`${options.fontSize}px ${options.fontFamily}`, options.text);
    await document.fonts.ready;
  }

  const probe = document.createElement("canvas");
  const probeContext = probe.getContext("2d");
  if (!probeContext) {
    throw new Error("Canvas context unavailable.");
  }
  probeContext.font = `${options.fontSize}px ${options.fontFamily}`;
  const metrics = probeContext.measureText(options.text);
  const width = Math.ceil(metrics.width + options.fontSize * 0.6);
  const height = Math.ceil(options.fontSize * 1.8);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }
  context.font = `${options.fontSize}px ${options.fontFamily}`;
  context.textBaseline = "middle";
  context.fillStyle = "#111111";
  context.fillText(options.text, options.fontSize * 0.25, height / 2);

  return createAssetFromCanvas(options.kind, canvas, options.existingCount, "typed");
}

export async function tintSignatureToPngBytes(dataUrl: string, colorHex: string) {
  const image = await loadImageFromUrl(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const color = hexToRgb(colorHex);

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) {
      continue;
    }
    data[index] = color.r;
    data[index + 1] = color.g;
    data[index + 2] = color.b;
  }

  context.putImageData(imageData, 0, 0);
  return dataUrlToBytes(canvas.toDataURL("image/png"));
}
