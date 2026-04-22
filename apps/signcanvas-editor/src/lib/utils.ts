import { clsx } from "clsx";

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function pointsToPixels(points: number, scale: number) {
  return points * scale;
}

export function pixelsToPoints(pixels: number, scale: number) {
  return pixels / scale;
}

export function fitPageScale(
  pageWidth: number,
  pageHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  const compactViewport = frameWidth < 640;
  const safeWidth = Math.max(frameWidth - (compactViewport ? 24 : 88), compactViewport ? 220 : 320);
  const safeHeight = Math.max(frameHeight - (compactViewport ? 24 : 72), compactViewport ? 220 : 320);
  const widthFirst = safeWidth / pageWidth;
  const heightLimited = safeHeight / pageHeight;

  if (compactViewport) {
    return widthFirst;
  }

  // Prefer filling the stage width while keeping a little safety margin so the
  // paper does not immediately spill into a horizontal scrollbar.
  return Math.min(widthFirst, Math.max(heightLimited, widthFirst * 0.96));
}

export function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized
        .split("")
        .map((char) => `${char}${char}`)
        .join("")
    : normalized;
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

export function rgbToCss({ r, g, b }: { r: number; g: number; b: number }) {
  return `rgb(${r}, ${g}, ${b})`;
}

export function guessMimeType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "image/png";
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function getPlacementSize(x0: number, y0: number, x1: number, y1: number) {
  return {
    width: x1 - x0,
    height: y1 - y0,
  };
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
