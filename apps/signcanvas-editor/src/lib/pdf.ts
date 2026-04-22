import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import type { Placement, SignatureAssetStore } from "../types/editor";
import { hexToRgb } from "./utils";
import { tintSignatureToPngBytes } from "./signature";

const pdfWorkerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
let pdfJsModulePromise: Promise<typeof import("pdfjs-dist")> | null = null;
let pdfLibModulePromise: Promise<typeof import("pdf-lib")> | null = null;

async function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
      return module;
    });
  }
  return pdfJsModulePromise;
}

async function getPdfLibModule() {
  if (!pdfLibModulePromise) {
    pdfLibModulePromise = import("pdf-lib");
  }
  return pdfLibModulePromise;
}

export async function loadPdfDocument(bytes: Uint8Array) {
  const { getDocument } = await getPdfJsModule();
  return getDocument({ data: bytes }).promise;
}

export async function renderPdfPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
) {
  const viewport = page.getViewport({ scale });
  const devicePixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  canvas.width = Math.floor(viewport.width * devicePixelRatio);
  canvas.height = Math.floor(viewport.height * devicePixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: devicePixelRatio === 1
      ? undefined
      : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
  }).promise;

  const baseViewport = page.getViewport({ scale: 1 });
  return {
    widthPx: viewport.width,
    heightPx: viewport.height,
    widthPts: baseViewport.width,
    heightPts: baseViewport.height,
  };
}

function buildAssetMap(store: SignatureAssetStore) {
  return new Map(
    [...store.signature, ...store.initials].map((asset) => [asset.id, asset]),
  );
}

export async function exportSignedPdf(
  originalBytes: Uint8Array,
  placementsByPage: Record<number, Placement[]>,
  assets: SignatureAssetStore,
) {
  const { PDFDocument: EditablePdf, StandardFonts, rgb } = await getPdfLibModule();
  const pdf = await EditablePdf.load(originalBytes);
  const pages = pdf.getPages();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const assetMap = buildAssetMap(assets);

  for (const [pageKey, placements] of Object.entries(placementsByPage)) {
    const pageIndex = Number(pageKey);
    const page = pages[pageIndex];
    if (!page) {
      continue;
    }
    const pageHeight = page.getHeight();

    for (const placement of placements) {
      if (placement.kind === "text") {
        const { r, g, b } = hexToRgb(placement.color);
        page.drawText(placement.text ?? "", {
          x: placement.x0,
          y: pageHeight - placement.y0 - (placement.fontSize ?? 18),
          size: placement.fontSize ?? 18,
          font: helvetica,
          color: rgb(r / 255, g / 255, b / 255),
        });
        continue;
      }

      const asset = placement.assetId ? assetMap.get(placement.assetId) : undefined;
      if (!asset) {
        continue;
      }
      const pngBytes = await tintSignatureToPngBytes(asset.imageDataUrl, placement.color);
      const image = await pdf.embedPng(pngBytes);
      page.drawImage(image, {
        x: placement.x0,
        y: pageHeight - placement.y1,
        width: placement.x1 - placement.x0,
        height: placement.y1 - placement.y0,
      });
    }
  }

  return pdf.save();
}
