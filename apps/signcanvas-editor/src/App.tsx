import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  MousePointer2,
  PanelLeft,
  PenLine,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { exportSignedPdf, loadPdfDocument, renderPdfPageToCanvas } from "./lib/pdf";
import {
  SCRIPT_FONT_OPTIONS,
  buildAssetLabel,
  cleanupImportedSignature,
  createAssetFromCanvas,
  createTypedSignatureAsset,
  tintSignatureToPngBytes,
} from "./lib/signature";
import { bytesToDataUrl, clamp, cn, createId, fitPageScale, getPlacementSize, guessMimeType } from "./lib/utils";
import { getPlatformBridge } from "./platform";
import { useEditorStore } from "./state/editor-store";
import type {
  EditorDocument,
  Placement,
  SignatureAsset,
  SignatureKind,
  SignatureAssetStore,
  Tool,
} from "./types/editor";

const bridge = getPlatformBridge();

const INK_SWATCHES = [
  { label: "Black", value: "#111111" },
  { label: "Navy", value: "#1E3A5F" },
  { label: "Oxblood", value: "#9B4743" },
  { label: "Amber", value: "#C96B2C" },
] as const;

type ToolMeta = {
  tool: Tool;
  label: string;
  hint: string;
  description: string;
  shortcut?: string;
  icon: ReactNode;
};

const TOOL_META: ToolMeta[] = [
  {
    tool: "signature",
    label: "Signatures",
    hint: "Sign",
    shortcut: "S",
    description: "Place full signatures with a single click.",
    icon: <PenLine className="h-4 w-4" />,
  },
  {
    tool: "initials",
    label: "Initials",
    hint: "Initial",
    shortcut: "I",
    description: "Keep smaller marks ready for repeated use.",
    icon: <ScanLine className="h-4 w-4" />,
  },
  {
    tool: "text",
    label: "Text",
    hint: "Text",
    shortcut: "T",
    description: "Add approvals, names, dates, or custom copy.",
    icon: <Type className="h-4 w-4" />,
  },
  {
    tool: "select",
    label: "Select",
    hint: "Select",
    shortcut: "V",
    description: "Move, review, and refine items on the page.",
    icon: <MousePointer2 className="h-4 w-4" />,
  },
];

type ButtonVariant = "solid" | "soft" | "ghost" | "outline";

function buttonClassName(variant: ButtonVariant = "soft", disabled = false) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition duration-150 select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas-panel",
    disabled && "cursor-not-allowed opacity-50",
    !disabled && variant === "solid" &&
      "border-canvas-accent bg-canvas-accent text-white shadow-sm hover:bg-canvas-accent-dark hover:shadow active:translate-y-[0.5px]",
    !disabled && variant === "soft" &&
      "border-canvas-stroke bg-white text-canvas-text hover:border-canvas-stroke-strong hover:bg-canvas-accent-soft",
    !disabled && variant === "outline" &&
      "border-canvas-stroke bg-transparent text-canvas-text hover:border-canvas-stroke-strong hover:bg-white",
    !disabled && variant === "ghost" &&
      "border-transparent bg-transparent text-canvas-muted hover:bg-white hover:text-canvas-text",
    disabled && variant === "solid" && "border-canvas-stroke bg-[#e1cab3] text-white",
    disabled && variant !== "solid" && "border-canvas-stroke bg-white/70 text-canvas-muted",
  );
}

function kindLabel(kind: SignatureKind) {
  return kind === "signature" ? "Signature" : "Initials";
}

function getErrorMessage(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

function useIsMobileLayout(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}

type ToastTone = "info" | "success" | "error";
type Toast = { id: string; message: string; tone: ToastTone };

function App() {
  const document = useEditorStore((state) => state.document);
  const tool = useEditorStore((state) => state.tool);
  const zoom = useEditorStore((state) => state.zoom);
  const placementsByPage = useEditorStore((state) => state.placementsByPage);
  const assets = useEditorStore((state) => state.assets);
  const activeAssetIds = useEditorStore((state) => state.activeAssetIds);
  const selectedPlacementId = useEditorStore((state) => state.selectedPlacementId);
  const ui = useEditorStore((state) => state.ui);
  const draftText = useEditorStore((state) => state.draftText);
  const draftTextSize = useEditorStore((state) => state.draftTextSize);
  const draftInkColor = useEditorStore((state) => state.draftInkColor);
  const lastPlacementSize = useEditorStore((state) => state.lastPlacementSize);

  const setDocument = useEditorStore((state) => state.setDocument);
  const setAssets = useEditorStore((state) => state.setAssets);
  const upsertAsset = useEditorStore((state) => state.upsertAsset);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const setTool = useEditorStore((state) => state.setTool);
  const setActiveAsset = useEditorStore((state) => state.setActiveAsset);
  const setZoom = useEditorStore((state) => state.setZoom);
  const setDraftText = useEditorStore((state) => state.setDraftText);
  const setDraftTextSize = useEditorStore((state) => state.setDraftTextSize);
  const setDraftInkColor = useEditorStore((state) => state.setDraftInkColor);
  const setSelectedPlacement = useEditorStore((state) => state.setSelectedPlacement);
  const addPlacement = useEditorStore((state) => state.addPlacement);
  const updatePlacement = useEditorStore((state) => state.updatePlacement);
  const deleteSelectedPlacement = useEditorStore((state) => state.deleteSelectedPlacement);
  const setPage = useEditorStore((state) => state.setPage);
  const openDrawModal = useEditorStore((state) => state.openDrawModal);
  const openTypedModal = useEditorStore((state) => state.openTypedModal);
  const openFinalize = useEditorStore((state) => state.openFinalize);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assetsHydrated, setAssetsHydrated] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"tools" | "properties" | null>(null);
  const isMobileLayout = useIsMobileLayout();

  const pushToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = createId("toast");
    setToasts((prev) => [...prev, { id, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, tone === "error" ? 6000 : 3500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const currentPlacements = document
    ? placementsByPage[document.currentPageIndex] ?? []
    : [];

  const totalPlacements = useMemo(
    () => Object.values(placementsByPage).reduce((sum, placements) => sum + placements.length, 0),
    [placementsByPage],
  );

  const assetMap = useMemo(
    () => new Map([...assets.signature, ...assets.initials].map((asset) => [asset.id, asset])),
    [assets.initials, assets.signature],
  );

  const selectedPlacement = currentPlacements.find(
    (placement) => placement.id === selectedPlacementId,
  ) ?? null;

  useEffect(() => {
    if (!isMobileLayout) {
      setMobilePanel(null);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    bridge.loadAssets()
      .then((loaded) => {
        setAssets(loaded);
      })
      .catch((error: unknown) => {
        pushToast(getErrorMessage(error, "Could not load local signatures."), "error");
      })
      .finally(() => setAssetsHydrated(true));
  }, [setAssets, pushToast]);

  useEffect(() => {
    if (!assetsHydrated) {
      return;
    }
    bridge.saveAssets(assets).catch((error: unknown) => {
      pushToast(getErrorMessage(error, "Could not save local signatures."), "error");
    });
  }, [assets, assetsHydrated, pushToast]);

  useEffect(() => {
    if (!document) {
      setPdfDoc(null);
    }
  }, [document?.originalBytes]);

  const handleOpenPdfFromFile = useCallback(
    async (file: { name: string; bytes: Uint8Array }) => {
      try {
        setBusy("Opening PDF");
        const documentBytes = file.bytes.slice();
        const loaded = await loadPdfDocument(file.bytes.slice());
        setPdfDoc(loaded);
        setDocument({
          name: file.name,
          originalBytes: documentBytes,
          pageCount: loaded.numPages,
          currentPageIndex: 0,
        });
        pushToast(`${file.name} is ready — place signatures, initials, or text.`, "success");
      } catch (error) {
        setPdfDoc(null);
        pushToast(getErrorMessage(error, "Could not open that PDF."), "error");
      } finally {
        setBusy(null);
      }
    },
    [pushToast, setDocument],
  );

  async function handleOpenPdf() {
    try {
      const file = await bridge.openPdf();
      await handleOpenPdfFromFile(file);
    } catch (error) {
      pushToast(getErrorMessage(error, "Could not open that PDF."), "error");
    }
  }

  async function handleImportAsset(kind: SignatureKind) {
    try {
      setBusy("Importing signature");
      const file = await bridge.importImage();
      const cleaned = await cleanupImportedSignature(file.bytes, guessMimeType(file.name));
      const asset: SignatureAsset = {
        id: createId(kind),
        kind,
        source: "imported",
        label: buildAssetLabel(kind, assets[kind].length, "imported"),
        imageDataUrl: cleaned.dataUrl,
        inkPreviewColor: "#111111",
        width: cleaned.width,
        height: cleaned.height,
      };
      upsertAsset(asset);
      setTool(kind);
      pushToast(`${asset.label} ready — click the page to place it.`, "success");
    } catch (error) {
      pushToast(getErrorMessage(error, `Could not import ${kind}.`), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleFinalize() {
    if (!document) {
      return;
    }
    try {
      setBusy("Finalizing PDF");
      const bytes = await exportSignedPdf(document.originalBytes, placementsByPage, assets);
      const name = document.name.replace(/\.pdf$/i, "") + "_signed.pdf";
      await bridge.savePdf(name, bytes);
      openFinalize(false);
      pushToast(`Saved ${name}.`, "success");
    } catch (error) {
      pushToast(getErrorMessage(error, "Could not export the signed PDF."), "error");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedPlacementId) {
        event.preventDefault();
        deleteSelectedPlacement();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        const lower = event.key.toLowerCase();
        if (lower === "s") {
          setTool("signature");
        } else if (lower === "i") {
          setTool("initials");
        } else if (lower === "t") {
          setTool("text");
        } else if (lower === "v" || event.key === "Escape") {
          setTool("select");
          if (event.key === "Escape") {
            setSelectedPlacement(null);
          }
        }
        return;
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoom(clamp(zoom * 1.15, 0.5, 4));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom(clamp(zoom / 1.15, 0.5, 4));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelectedPlacement, selectedPlacementId, setSelectedPlacement, setTool, setZoom, zoom]);

  function placeAt(options: {
    tool: Tool;
    x: number;
    y: number;
    pageWidth: number;
    pageHeight: number;
  }) {
    if (!document || options.tool === "select") {
      return;
    }

    if (options.tool === "text") {
      const text = draftText.trim();
      if (!text) {
        pushToast("Type your text in the right panel, then click the page.", "info");
        return;
      }
      const width = Math.max(options.pageWidth * 0.16, text.length * draftTextSize * 0.58 + 30);
      const height = Math.max(draftTextSize * 1.7, 32);
      const x0 = clamp(options.x - width / 2, 0, options.pageWidth - width);
      const y0 = clamp(options.y - height / 2, 0, options.pageHeight - height);
      const placement: Placement = {
        id: createId("text"),
        pageIndex: document.currentPageIndex,
        kind: "text",
        x0,
        y0,
        x1: x0 + width,
        y1: y0 + height,
        color: draftInkColor,
        text,
        fontSize: draftTextSize,
      };
      addPlacement(placement);
      if (isMobileLayout) {
        setSelectedPlacement(null);
        setTool("text");
      }
      return;
    }

    const kind = options.tool as SignatureKind;
    const activeAsset = assets[kind].find((asset) => asset.id === activeAssetIds[kind]) ??
      assets[kind][0];
    if (!activeAsset) {
      pushToast(`Create a ${kind} first — use Draw, Type, or Import on the left.`, "info");
      return;
    }

    const aspect = activeAsset.height / Math.max(activeAsset.width, 1);
    const remembered = lastPlacementSize[kind];
    const defaultWidthRatio = kind === "signature"
      ? (isMobileLayout ? 0.2 : 0.28)
      : (isMobileLayout ? 0.12 : 0.16);
    const width = remembered?.width ?? options.pageWidth * defaultWidthRatio;
    const height = remembered?.height ?? width * aspect;
    const safeWidth = Math.min(width, options.pageWidth * 0.95);
    const safeHeight = Math.min(height, options.pageHeight * 0.95);
    const x0 = clamp(options.x - safeWidth / 2, 0, options.pageWidth - safeWidth);
    const y0 = clamp(options.y - safeHeight / 2, 0, options.pageHeight - safeHeight);
    const placement: Placement = {
      id: createId(kind),
      pageIndex: document.currentPageIndex,
      kind,
      assetId: activeAsset.id,
      x0,
      y0,
      x1: x0 + safeWidth,
      y1: y0 + safeHeight,
      color: draftInkColor,
    };
    addPlacement(placement);
    if (isMobileLayout) {
      setSelectedPlacement(null);
      setTool(kind);
    }
  }

  function updateSelectedInk(color: string) {
    setDraftInkColor(color);
    if (selectedPlacement) {
      updatePlacement(selectedPlacement.id, (placement) => ({ ...placement, color }));
    }
  }

  function replaceSelectedAsset(assetId: string) {
    if (!selectedPlacement || selectedPlacement.kind === "text") {
      return;
    }
    setActiveAsset(selectedPlacement.kind, assetId);
    updatePlacement(selectedPlacement.id, (placement) => ({ ...placement, assetId }));
  }

  function handleUseAsset(asset: SignatureAsset) {
    setActiveAsset(asset.kind, asset.id);
    setTool(asset.kind);
    if (selectedPlacement && selectedPlacement.kind === asset.kind) {
      replaceSelectedAsset(asset.id);
    }
  }

  function handleDeleteAsset(asset: SignatureAsset) {
    const confirmed = window.confirm(`Delete ${asset.label}? Any placed copies in this document will also be removed.`);
    if (!confirmed) {
      return;
    }
    removeAsset(asset.kind, asset.id);
    pushToast(`${asset.label} deleted.`, "success");
  }

  function handleWindowDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types?.includes("Files")) {
      return;
    }
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleWindowDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types?.includes("Files")) {
      return;
    }
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleWindowDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      setIsDragActive(false);
    }
  }

  async function handleWindowDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      pushToast("Drop a PDF to open it.", "info");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await handleOpenPdfFromFile({ name: file.name, bytes });
  }

  return (
    <div
      className="relative min-h-full text-canvas-text lg:h-full lg:overflow-hidden"
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      <div className="relative flex min-h-full min-w-0 flex-col gap-2 px-2 py-2 sm:gap-3 sm:px-3 sm:py-3 lg:absolute lg:inset-0 lg:px-4 lg:py-4">
        <div className="flex min-h-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
          <TopBar
            isMobileLayout={isMobileLayout}
            busy={busy}
            document={document}
            zoom={zoom}
            onOpen={handleOpenPdf}
            onZoomIn={() => setZoom(clamp(zoom * 1.15, 0.5, 4))}
            onZoomOut={() => setZoom(clamp(zoom / 1.15, 0.5, 4))}
            onZoomReset={() => setZoom(1)}
            onFinalize={() => openFinalize(true)}
            onPrevPage={() => document && setPage(document.currentPageIndex - 1)}
            onNextPage={() => document && setPage(document.currentPageIndex + 1)}
            totalPlacements={totalPlacements}
            onOpenTools={() => setMobilePanel("tools")}
            onOpenProperties={() => setMobilePanel("properties")}
          />

          <div className="grid min-h-0 min-w-0 flex-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_288px]">
            {!isMobileLayout && (
              <LeftRail
                tool={tool}
                assets={assets}
                activeAssetIds={activeAssetIds}
                selectedPlacement={selectedPlacement}
                onSelectTool={setTool}
                onUseAsset={handleUseAsset}
                onDeleteAsset={handleDeleteAsset}
                onDraw={openDrawModal}
                onType={openTypedModal}
                onImport={handleImportAsset}
              />
            )}

            <main className="min-h-0 min-w-0">
              <DocumentStage
                mobile={isMobileLayout}
                pdfDoc={pdfDoc}
                documentName={document?.name ?? ""}
                pageIndex={document?.currentPageIndex ?? 0}
                pageCount={document?.pageCount ?? 0}
                placements={currentPlacements}
                selectedPlacementId={selectedPlacementId}
                tool={tool}
                zoom={zoom}
                assets={assetMap}
                onPlace={placeAt}
                onSelect={setSelectedPlacement}
                onUpdatePlacement={updatePlacement}
                onOpenPdf={handleOpenPdf}
                busy={busy}
              />
            </main>

            {!isMobileLayout && (
              <div className="min-h-0">
                <PropertiesPanel
                  document={document}
                  tool={tool}
                  totalPlacements={totalPlacements}
                  selectedPlacement={selectedPlacement}
                  selectedAsset={selectedPlacement?.assetId ? assetMap.get(selectedPlacement.assetId) ?? null : null}
                  assets={assets}
                  draftText={draftText}
                  draftTextSize={draftTextSize}
                  draftInkColor={draftInkColor}
                  onDraftText={setDraftText}
                  onDraftTextSize={setDraftTextSize}
                  onInkChange={updateSelectedInk}
                  onReplaceAsset={replaceSelectedAsset}
                  onUpdatePlacement={(updater) => {
                    if (!selectedPlacement) {
                      return;
                    }
                    updatePlacement(selectedPlacement.id, updater);
                  }}
                  onDeletePlacement={deleteSelectedPlacement}
                  onPrevPage={() => document && setPage(document.currentPageIndex - 1)}
                  onNextPage={() => document && setPage(document.currentPageIndex + 1)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {isDragActive && !busy && (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-[22px] border-2 border-dashed border-canvas-accent bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-canvas-accent">
            <Upload className="h-10 w-10" />
            <div className="font-display text-2xl text-canvas-text">Drop your PDF to open</div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {isMobileLayout && selectedPlacement && (
        <div className="pointer-events-none fixed inset-x-3 bottom-3 z-40 sm:hidden">
          <div className="pointer-events-auto mx-auto flex max-w-sm items-center gap-2 rounded-2xl border border-canvas-stroke bg-canvas-panel/95 p-2 shadow-panel-lg backdrop-blur-sm">
            <div className="min-w-0 flex-1 px-1">
              <div className="text-[0.62rem] font-semibold uppercase tracking-label text-canvas-muted">
                Selected
              </div>
              <div className="truncate text-sm font-medium text-canvas-text-soft">
                {selectedPlacement.kind === "text" ? "Text field" : kindLabel(selectedPlacement.kind)}
              </div>
            </div>
            <button
              className={cn(buttonClassName("soft", false), "h-10 shrink-0 px-3 text-xs")}
              onClick={() => setMobilePanel("properties")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Properties
            </button>
            <button
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-canvas-oxblood/25 bg-[#fff4f1] px-3 text-xs font-medium text-canvas-oxblood transition hover:border-canvas-oxblood/50 hover:bg-[#ffe9e3]"
              onClick={deleteSelectedPlacement}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      )}

      {isMobileLayout && mobilePanel === "tools" && (
        <ModalShell title="Tools & assets" onClose={() => setMobilePanel(null)}>
          <LeftRail
            mobile
            tool={tool}
            assets={assets}
            activeAssetIds={activeAssetIds}
            selectedPlacement={selectedPlacement}
            onSelectTool={(nextTool) => {
              setTool(nextTool);
              if (nextTool === "text") {
                setMobilePanel("properties");
                return;
              }
              setMobilePanel(null);
            }}
            onUseAsset={(asset) => {
              handleUseAsset(asset);
              setMobilePanel(null);
            }}
            onDeleteAsset={handleDeleteAsset}
            onDraw={(kind) => {
              openDrawModal(kind);
              setMobilePanel(null);
            }}
            onType={(kind) => {
              openTypedModal(kind);
              setMobilePanel(null);
            }}
            onImport={(kind) => {
              setMobilePanel(null);
              void handleImportAsset(kind);
            }}
          />
        </ModalShell>
      )}

      {isMobileLayout && mobilePanel === "properties" && (
        <ModalShell title="Properties" onClose={() => setMobilePanel(null)}>
          <PropertiesPanel
            mobile
            document={document}
            tool={tool}
            totalPlacements={totalPlacements}
            selectedPlacement={selectedPlacement}
            selectedAsset={selectedPlacement?.assetId ? assetMap.get(selectedPlacement.assetId) ?? null : null}
            assets={assets}
            draftText={draftText}
            draftTextSize={draftTextSize}
            draftInkColor={draftInkColor}
            onDraftText={setDraftText}
            onDraftTextSize={setDraftTextSize}
            onInkChange={updateSelectedInk}
            onReplaceAsset={replaceSelectedAsset}
            onUpdatePlacement={(updater) => {
              if (!selectedPlacement) {
                return;
              }
              updatePlacement(selectedPlacement.id, updater);
            }}
            onDeletePlacement={deleteSelectedPlacement}
            onPrevPage={() => document && setPage(document.currentPageIndex - 1)}
            onNextPage={() => document && setPage(document.currentPageIndex + 1)}
          />
        </ModalShell>
      )}

      {ui.drawKind && (
        <DrawSignatureModal
          kind={ui.drawKind}
          existingCount={assets[ui.drawKind].length}
          onClose={() => openDrawModal(null)}
          onSave={(asset) => {
            upsertAsset(asset);
            setTool(asset.kind);
            openDrawModal(null);
            pushToast(`${asset.label} saved — click the page to place it.`, "success");
          }}
        />
      )}

      {ui.typedKind && (
        <TypedSignatureModal
          kind={ui.typedKind}
          existingCount={assets[ui.typedKind].length}
          onClose={() => openTypedModal(null)}
          onSave={(asset) => {
            upsertAsset(asset);
            setTool(asset.kind);
            openTypedModal(null);
            pushToast(`${asset.label} saved — click the page to place it.`, "success");
          }}
        />
      )}

      {ui.finalizeOpen && (
        <FinalizeModal
          placementCount={totalPlacements}
          busy={busy === "Finalizing PDF"}
          documentName={document?.name ?? ""}
          onCancel={() => openFinalize(false)}
          onConfirm={handleFinalize}
        />
      )}
    </div>
  );
}

function TopBar(props: {
  isMobileLayout: boolean;
  busy: string | null;
  document: EditorDocument | null;
  zoom: number;
  totalPlacements: number;
  onOpen(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  onFinalize(): void;
  onPrevPage(): void;
  onNextPage(): void;
  onOpenTools(): void;
  onOpenProperties(): void;
}) {
  const canGoPrev = Boolean(props.document && props.document.currentPageIndex > 0);
  const canGoNext = Boolean(
    props.document && props.document.currentPageIndex < props.document.pageCount - 1,
  );

  const openBusy = Boolean(props.busy);
  const finalizeDisabled = !props.document || Boolean(props.busy);
  const finalizing = props.busy === "Finalizing PDF";

  if (props.isMobileLayout) {
    return (
      <header className="sticky top-2 z-30 rounded-2xl border border-canvas-stroke bg-canvas-panel/95 px-2.5 py-2 shadow-panel backdrop-blur-[2px]">
        {/* Row 1 — brand + Open PDF + (filename chip once loaded) */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-canvas-accent text-white shadow-sm">
              <PenLine className="h-4 w-4" strokeWidth={2.4} />
            </div>
            <div className="font-display text-[1.15rem] font-semibold leading-none text-canvas-text">
              SignCanvas
            </div>
          </div>

          {props.document ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-canvas-stroke bg-white/70 px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-canvas-muted" />
              <span className="truncate font-medium text-canvas-text-soft">{props.document.name}</span>
            </div>
          ) : null}

          <button
            className={cn(
              buttonClassName("soft", openBusy),
              "h-9 px-2.5 text-xs",
              !props.document && "ml-auto",
            )}
            onClick={props.onOpen}
            disabled={openBusy}
            aria-label="Open PDF"
          >
            {props.busy === "Opening PDF" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            <span className={props.document ? "sr-only" : undefined}>
              {props.busy === "Opening PDF" ? "Opening..." : "Open PDF"}
            </span>
          </button>
        </div>

        {/* Row 2 — controls. Wraps so Finalize never clips on narrow screens. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {props.document && (
            <div className="flex shrink-0 items-center rounded-xl border border-canvas-stroke bg-white/70 p-0.5">
              <IconButton
                title="Previous page (←)"
                disabled={!canGoPrev}
                onClick={props.onPrevPage}
                icon={<ChevronLeft className="h-4 w-4" />}
              />
              <div className="px-1 text-xs font-medium tabular-nums text-canvas-text-soft">
                {props.document.currentPageIndex + 1}
                <span className="mx-0.5 text-canvas-muted">/</span>
                {props.document.pageCount}
              </div>
              <IconButton
                title="Next page (→)"
                disabled={!canGoNext}
                onClick={props.onNextPage}
                icon={<ChevronRight className="h-4 w-4" />}
              />
            </div>
          )}

          <div className="flex shrink-0 items-center rounded-xl border border-canvas-stroke bg-white/70 p-0.5">
            <IconButton title="Zoom out" onClick={props.onZoomOut} icon={<ZoomOut className="h-4 w-4" />} />
            <button
              className="rounded-lg px-1 py-1 text-xs font-medium tabular-nums text-canvas-text-soft hover:bg-canvas-accent-soft"
              onClick={props.onZoomReset}
              title="Reset zoom"
            >
              {Math.round(props.zoom * 100)}%
            </button>
            <IconButton title="Zoom in" onClick={props.onZoomIn} icon={<ZoomIn className="h-4 w-4" />} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              className={cn(buttonClassName("soft", false), "h-9 shrink-0 px-2.5 text-xs")}
              onClick={props.onOpenTools}
              aria-label="Tools, signatures, and initials"
              title="Tools, signatures, and initials"
            >
              <PenLine className="h-4 w-4" />
              <span>Tools</span>
            </button>
            <button
              className={cn(buttonClassName("soft", false), "h-9 w-9 shrink-0 !px-0")}
              onClick={props.onOpenProperties}
              aria-label="Properties"
              title="Properties"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              className={cn(buttonClassName("solid", finalizeDisabled), "h-9 shrink-0 px-2.5 text-xs")}
              disabled={finalizeDisabled}
              onClick={props.onFinalize}
              title={props.totalPlacements === 0 ? "Place at least one item before exporting" : "Export signed PDF"}
              aria-label="Finalize and export signed PDF"
            >
              {finalizing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span>{finalizing ? "Finalizing..." : "Finalize"}</span>
            </button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="rounded-2xl border border-canvas-stroke bg-canvas-panel/95 px-3 py-2.5 shadow-panel backdrop-blur-[2px] sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5 pr-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-canvas-accent text-white shadow-sm">
            <PenLine className="h-4 w-4" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[1.35rem] font-semibold text-canvas-text">SignCanvas</div>
            <div className="text-[0.64rem] uppercase tracking-label text-canvas-muted">
              PDF Signing Studio
            </div>
          </div>
        </div>

        <button className={buttonClassName("soft", openBusy)} onClick={props.onOpen} disabled={openBusy}>
          {props.busy === "Opening PDF" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {props.busy === "Opening PDF" ? "Opening..." : "Open PDF"}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 truncate rounded-xl border border-canvas-stroke bg-white/70 px-3 py-2 text-sm sm:max-w-[280px]">
          <FileText className="h-3.5 w-3.5 shrink-0 text-canvas-muted" />
          <span className="truncate font-medium text-canvas-text-soft">
            {props.document?.name ?? <span className="text-canvas-muted">No document open</span>}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {props.document && (
          <div className="flex items-center rounded-xl border border-canvas-stroke bg-white/70 p-0.5">
            <IconButton
              title="Previous page (←)"
              disabled={!canGoPrev}
              onClick={props.onPrevPage}
              icon={<ChevronLeft className="h-4 w-4" />}
            />
            <div className="px-2.5 text-sm font-medium tabular-nums text-canvas-text-soft">
              {props.document.currentPageIndex + 1}
              <span className="mx-1 text-canvas-muted">/</span>
              {props.document.pageCount}
            </div>
            <IconButton
              title="Next page (→)"
              disabled={!canGoNext}
              onClick={props.onNextPage}
              icon={<ChevronRight className="h-4 w-4" />}
            />
          </div>
        )}

        <div className="flex items-center rounded-xl border border-canvas-stroke bg-white/70 p-0.5">
          <IconButton title="Zoom out (⌘/Ctrl -)" onClick={props.onZoomOut} icon={<ZoomOut className="h-4 w-4" />} />
          <button
            className="rounded-lg px-2 py-1 text-sm font-medium tabular-nums text-canvas-text-soft hover:bg-canvas-accent-soft"
            onClick={props.onZoomReset}
            title="Reset zoom (⌘/Ctrl 0)"
          >
            {Math.round(props.zoom * 100)}%
          </button>
          <IconButton title="Zoom in (⌘/Ctrl +)" onClick={props.onZoomIn} icon={<ZoomIn className="h-4 w-4" />} />
        </div>

        <button
          className={buttonClassName("solid", finalizeDisabled)}
          disabled={finalizeDisabled}
          onClick={props.onFinalize}
          title={props.totalPlacements === 0 ? "Place at least one item before exporting" : "Export signed PDF"}
        >
          {finalizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Finalize
            </>
          )}
        </button>
      </div>
    </header>
  );
}

function IconButton(props: {
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-canvas-muted transition",
        props.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-canvas-accent-soft hover:text-canvas-text",
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
    >
      {props.icon}
    </button>
  );
}

function LeftRail(props: {
  mobile?: boolean;
  tool: Tool;
  assets: SignatureAssetStore;
  activeAssetIds: Record<SignatureKind, string | null>;
  selectedPlacement: Placement | null;
  onSelectTool(tool: Tool): void;
  onUseAsset(asset: SignatureAsset): void;
  onDeleteAsset(asset: SignatureAsset): void;
  onDraw(kind: SignatureKind): void;
  onType(kind: SignatureKind): void;
  onImport(kind: SignatureKind): void;
}) {
  return (
    <aside className={cn(
      "flex min-h-0 flex-col gap-3 rounded-2xl border border-canvas-stroke bg-canvas-panel/95 p-3",
      props.mobile ? "max-h-[72dvh] overflow-y-auto no-scrollbar" : "thin-scrollbar overflow-y-auto shadow-panel",
    )}>
      <PanelSection title="Tools">
        <div className="grid grid-cols-2 gap-1.5">
          {TOOL_META.map((item) => (
            <ToolButton
              key={item.tool}
              active={props.tool === item.tool}
              icon={item.icon}
              label={item.hint}
              shortcut={item.shortcut}
              onClick={() => props.onSelectTool(item.tool)}
            />
          ))}
        </div>
      </PanelSection>

      <AssetSection
        title="Signatures"
        kind="signature"
        assets={props.assets.signature}
        selectedPlacement={props.selectedPlacement}
        activeAssetId={props.activeAssetIds.signature}
        onUseAsset={props.onUseAsset}
        onDeleteAsset={props.onDeleteAsset}
        onDraw={props.onDraw}
        onType={props.onType}
        onImport={props.onImport}
      />

      <AssetSection
        title="Initials"
        kind="initials"
        assets={props.assets.initials}
        selectedPlacement={props.selectedPlacement}
        activeAssetId={props.activeAssetIds.initials}
        onUseAsset={props.onUseAsset}
        onDeleteAsset={props.onDeleteAsset}
        onDraw={props.onDraw}
        onType={props.onType}
        onImport={props.onImport}
      />

      <div className="mt-auto rounded-xl border border-canvas-stroke bg-white/60 px-3 py-2.5 text-[0.7rem] leading-5 text-canvas-muted">
        <div className="mb-1 font-semibold uppercase tracking-label text-canvas-text-soft">Shortcuts</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="sc-kbd">S</span><span>Sign</span>
          <span className="sc-kbd">I</span><span>Initial</span>
          <span className="sc-kbd">T</span><span>Text</span>
          <span className="sc-kbd">V</span><span>Select</span>
        </div>
      </div>
    </aside>
  );
}

function PanelSection(props: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="text-[0.66rem] font-semibold uppercase tracking-label text-canvas-muted">
          {props.title}
        </div>
        {props.action}
      </div>
      <div className="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}

function ToolButton(props: {
  active: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "group relative flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas-accent/45",
        props.active
          ? "border-canvas-accent bg-white text-canvas-accent shadow-sm"
          : "border-canvas-stroke bg-white/60 text-canvas-muted hover:border-canvas-stroke-strong hover:bg-white hover:text-canvas-text",
      )}
      onClick={props.onClick}
    >
      <div className={cn("transition", props.active ? "text-canvas-accent" : "text-canvas-muted group-hover:text-canvas-text")}>
        {props.icon}
      </div>
      <div>{props.label}</div>
      {props.shortcut && (
        <span className={cn(
          "absolute right-1.5 top-1.5 text-[0.58rem] font-semibold tracking-wider",
          props.active ? "text-canvas-accent/60" : "text-canvas-muted/70",
        )}>
          {props.shortcut}
        </span>
      )}
    </button>
  );
}

function AssetSection(props: {
  title: string;
  kind: SignatureKind;
  assets: SignatureAsset[];
  selectedPlacement: Placement | null;
  activeAssetId: string | null;
  onUseAsset(asset: SignatureAsset): void;
  onDeleteAsset(asset: SignatureAsset): void;
  onDraw(kind: SignatureKind): void;
  onType(kind: SignatureKind): void;
  onImport(kind: SignatureKind): void;
}) {
  return (
    <PanelSection
      title={props.title}
      action={props.assets.length > 0 ? (
        <span className="rounded-full bg-canvas-accent-soft px-1.5 py-0.5 text-[0.6rem] font-semibold text-canvas-accent-dark">
          {props.assets.length}
        </span>
      ) : null}
    >
      {props.assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-canvas-stroke bg-white/50 px-3 py-3 text-center text-xs leading-5 text-canvas-muted">
          No {props.kind} yet.
          <br />
          <span className="text-[0.68rem]">Draw, type, or import below.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {props.assets.map((asset) => {
            const isPlacementMatch = props.selectedPlacement?.assetId === asset.id;
            const isActive = props.activeAssetId === asset.id;
            return (
              <button
                key={asset.id}
                className={cn(
                  "group relative rounded-xl border bg-white px-2.5 py-2 text-left transition",
                  "hover:border-canvas-accent hover:shadow-sm",
                  isPlacementMatch || isActive ? "border-canvas-accent" : "border-canvas-stroke",
                )}
                onClick={() => props.onUseAsset(asset)}
                title={`Use ${asset.label}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-canvas-text">{asset.label}</div>
                    <div className="mt-0.5 text-[0.6rem] uppercase tracking-label text-canvas-muted">
                      {asset.source}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isActive && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-canvas-accent text-white">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </div>
                    )}
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-canvas-stroke bg-white text-canvas-muted transition hover:border-canvas-oxblood hover:bg-[#fff4f1] hover:text-canvas-oxblood"
                      aria-label={`Delete ${asset.label}`}
                      title={`Delete ${asset.label}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onDeleteAsset(asset);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 rounded-md border border-canvas-stroke/70 bg-canvas-paper p-1.5">
                  <img src={asset.imageDataUrl} alt={asset.label} className="max-h-9 w-full object-contain" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-1 grid grid-cols-3 gap-1.5">
        <AssetActionButton label="Draw" onClick={() => props.onDraw(props.kind)} />
        <AssetActionButton label="Type" onClick={() => props.onType(props.kind)} />
        <AssetActionButton label="Upload" icon={<Upload className="h-3 w-3" />} onClick={() => props.onImport(props.kind)} />
      </div>
    </PanelSection>
  );
}

function AssetActionButton(props: { label: string; icon?: ReactNode; onClick(): void }) {
  return (
    <button
      className="inline-flex items-center justify-center gap-1 rounded-lg border border-canvas-stroke bg-white/70 px-2 py-1.5 text-[0.72rem] font-medium text-canvas-text-soft transition hover:border-canvas-accent hover:bg-canvas-accent-soft hover:text-canvas-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas-accent/40"
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function PropertiesPanel(props: {
  mobile?: boolean;
  document: EditorDocument | null;
  tool: Tool;
  totalPlacements: number;
  selectedPlacement: Placement | null;
  selectedAsset: SignatureAsset | null;
  assets: SignatureAssetStore;
  draftText: string;
  draftTextSize: number;
  draftInkColor: string;
  onDraftText(value: string): void;
  onDraftTextSize(value: number): void;
  onInkChange(color: string): void;
  onReplaceAsset(assetId: string): void;
  onUpdatePlacement(updater: (placement: Placement) => Placement): void;
  onDeletePlacement(): void;
  onPrevPage(): void;
  onNextPage(): void;
}) {
  const isText = props.selectedPlacement?.kind === "text";
  const selectedSignaturePlacement: (Placement & { kind: SignatureKind }) | null =
    props.selectedPlacement && props.selectedPlacement.kind !== "text"
      ? { ...props.selectedPlacement, kind: props.selectedPlacement.kind }
      : null;
  const selectedSignatureKind: SignatureKind | null = selectedSignaturePlacement
    ? selectedSignaturePlacement.kind
    : null;
  const selectedSignatureAsset = selectedSignaturePlacement ? props.selectedAsset : null;
  const selectedSize = props.selectedPlacement
    ? getPlacementSize(
        props.selectedPlacement.x0,
        props.selectedPlacement.y0,
        props.selectedPlacement.x1,
        props.selectedPlacement.y1,
      )
    : null;

  const headerLabel = props.selectedPlacement
    ? props.selectedPlacement.kind === "text" ? "Text field" : kindLabel(props.selectedPlacement.kind)
    : "Document";
  const headerSub = props.selectedPlacement
    ? "Editing selection"
    : props.document
    ? `${props.totalPlacements} placement${props.totalPlacements === 1 ? "" : "s"}`
    : "Open a PDF to begin";

  return (
    <aside className={cn(
      "flex h-full min-h-0 flex-col overflow-y-auto rounded-2xl border border-canvas-stroke bg-canvas-panel/95",
      props.mobile ? "no-scrollbar" : "thin-scrollbar shadow-panel",
    )}>
      <div className="flex items-start justify-between gap-2 border-b border-canvas-stroke px-4 py-3">
        <div className="min-w-0">
          <div className="text-[0.66rem] font-semibold uppercase tracking-label text-canvas-muted">Properties</div>
          <div className="mt-1 truncate text-lg font-display font-semibold text-canvas-text">{headerLabel}</div>
          <div className="mt-0.5 text-xs text-canvas-muted">{headerSub}</div>
        </div>
        {props.selectedPlacement && (
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-canvas-stroke bg-white text-canvas-muted transition hover:border-canvas-oxblood hover:bg-[#fff0ee] hover:text-canvas-oxblood focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas-oxblood/40"
            onClick={props.onDeletePlacement}
            title="Delete (Del)"
            aria-label="Delete placement"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {!props.document && (
          <div className="rounded-xl border border-canvas-stroke bg-white/70 p-4 text-sm leading-6 text-canvas-muted">
            Open a PDF from the top bar or drop it anywhere on the window.
            Then place signatures, initials, or text from the left panel.
          </div>
        )}

        {props.document && !props.selectedPlacement && (
          <Field label="Active tool" value={TOOL_META.find((item) => item.tool === props.tool)?.label ?? "—"} />
        )}

        <InkSection
          color={props.selectedPlacement?.color ?? props.draftInkColor}
          onChange={props.onInkChange}
        />

        {selectedSignaturePlacement && selectedSignatureAsset && selectedSignatureKind && selectedSize && (
          <PanelCard title="Signature">
            <div className="rounded-lg border border-canvas-stroke bg-canvas-paper p-2">
              <img
                src={selectedSignatureAsset.imageDataUrl}
                alt={selectedSignatureAsset.label}
                className="max-h-14 w-full object-contain"
              />
            </div>

            <Slider
              label="Size"
              suffix={`${Math.round(selectedSize.width)}pt`}
              min={60}
              max={460}
              value={selectedSize.width}
              onChange={(width) => {
                const aspect = selectedSignatureAsset.height / Math.max(selectedSignatureAsset.width, 1);
                props.onUpdatePlacement((placement) => ({
                  ...placement,
                  x1: placement.x0 + width,
                  y1: placement.y0 + width * aspect,
                }));
              }}
            />

            {props.assets[selectedSignatureKind].length > 1 && (
              <div>
                <MiniLabel>Swap asset</MiniLabel>
                <div className="mt-1.5 grid gap-1.5">
                  {props.assets[selectedSignatureKind].map((asset) => (
                    <button
                      key={asset.id}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border p-1.5 text-left transition",
                        "hover:border-canvas-accent",
                        selectedSignaturePlacement.assetId === asset.id
                          ? "border-canvas-accent bg-canvas-accent-soft"
                          : "border-canvas-stroke bg-white",
                      )}
                      onClick={() => props.onReplaceAsset(asset.id)}
                    >
                      <img src={asset.imageDataUrl} alt={asset.label} className="h-7 w-12 rounded-sm border border-canvas-stroke/60 bg-canvas-paper object-contain p-0.5" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-canvas-text">{asset.label}</div>
                        <div className="text-[0.62rem] uppercase tracking-label text-canvas-muted">{asset.source}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </PanelCard>
        )}

        {(isText || props.tool === "text") && (
          <PanelCard title={isText ? "Text content" : "New text field"}>
            <textarea
              className="min-h-24 w-full rounded-lg border border-canvas-stroke bg-white px-3 py-2 text-sm text-canvas-text outline-none transition focus:border-canvas-accent focus:ring-2 focus:ring-canvas-accent/20"
              placeholder={isText ? "" : "e.g. Approved · Jane Smith · 04/21"}
              value={isText ? props.selectedPlacement?.text ?? "" : props.draftText}
              onChange={(event) => {
                const next = event.target.value;
                if (isText && props.selectedPlacement) {
                  props.onUpdatePlacement((placement) => {
                    const fontSize = placement.fontSize ?? 18;
                    const width = Math.max(next.length * fontSize * 0.58 + 30, 110);
                    const height = Math.max(fontSize * 1.7, 32);
                    return {
                      ...placement,
                      text: next,
                      x1: placement.x0 + width,
                      y1: placement.y0 + height,
                    };
                  });
                } else {
                  props.onDraftText(next);
                }
              }}
            />

            <Slider
              label="Font size"
              suffix={`${isText ? props.selectedPlacement?.fontSize ?? 18 : props.draftTextSize}pt`}
              min={10}
              max={40}
              value={isText ? props.selectedPlacement?.fontSize ?? 18 : props.draftTextSize}
              onChange={(next) => {
                if (isText && props.selectedPlacement) {
                  props.onUpdatePlacement((placement) => {
                    const text = placement.text ?? "";
                    const width = Math.max(text.length * next * 0.58 + 30, 110);
                    const height = Math.max(next * 1.7, 32);
                    return {
                      ...placement,
                      fontSize: next,
                      x1: placement.x0 + width,
                      y1: placement.y0 + height,
                    };
                  });
                } else {
                  props.onDraftTextSize(next);
                }
              }}
            />
          </PanelCard>
        )}

        {props.document && !props.selectedPlacement && props.tool !== "text" && (
          <PanelCard title="Tips">
            <ul className="flex flex-col gap-1.5 text-xs leading-5 text-canvas-muted">
              <li>• Pick a tool, then click the page to drop it.</li>
              <li>• Drag items to reposition, or drag the corner handle to resize.</li>
              <li>• Use the ink swatches to tint a signature.</li>
              <li>• Press <span className="sc-kbd">Del</span> to remove a selection.</li>
            </ul>
          </PanelCard>
        )}
      </div>
    </aside>
  );
}

function PanelCard(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-canvas-stroke bg-white/75 p-3 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]">
      <div className="text-[0.62rem] font-semibold uppercase tracking-label text-canvas-muted">
        {props.title}
      </div>
      <div className="mt-2 flex flex-col gap-3">{props.children}</div>
    </div>
  );
}

function Field(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-canvas-stroke bg-white/60 px-3 py-2">
      <div className="text-[0.62rem] font-semibold uppercase tracking-label text-canvas-muted">{props.label}</div>
      <div className="mt-0.5 text-sm font-medium text-canvas-text-soft">{props.value}</div>
    </div>
  );
}

function MiniLabel(props: { children: ReactNode }) {
  return (
    <div className="text-[0.62rem] font-semibold uppercase tracking-label text-canvas-muted">
      {props.children}
    </div>
  );
}

function Slider(props: {
  label: string;
  suffix?: string;
  min: number;
  max: number;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <MiniLabel>{props.label}</MiniLabel>
        {props.suffix && (
          <div className="text-xs tabular-nums text-canvas-muted">{props.suffix}</div>
        )}
      </div>
      <input
        className="mt-2 w-full accent-canvas-accent"
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}

function InkSection(props: { color: string; onChange(color: string): void }) {
  return (
    <PanelCard title="Ink">
      <div className="flex flex-wrap items-center gap-1.5">
        {INK_SWATCHES.map((swatch) => {
          const active = props.color.toLowerCase() === swatch.value.toLowerCase();
          return (
            <button
              key={swatch.value}
              className={cn(
                "group relative h-8 w-8 rounded-full border transition",
                active
                  ? "border-canvas-accent ring-2 ring-canvas-accent/30"
                  : "border-canvas-stroke hover:border-canvas-stroke-strong",
              )}
              style={{ backgroundColor: swatch.value }}
              onClick={() => props.onChange(swatch.value)}
              title={swatch.label}
              aria-label={swatch.label}
            >
              {active && <Check className="absolute inset-0 m-auto h-3 w-3 text-white mix-blend-screen" strokeWidth={3} />}
            </button>
          );
        })}
        <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-canvas-stroke bg-white hover:border-canvas-accent" title="Custom color">
          <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: props.color }} />
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            type="color"
            value={props.color}
            onChange={(event) => props.onChange(event.target.value)}
          />
        </label>
      </div>
    </PanelCard>
  );
}

function DocumentStage(props: {
  mobile?: boolean;
  pdfDoc: PDFDocumentProxy | null;
  documentName: string;
  pageIndex: number;
  pageCount: number;
  placements: Placement[];
  selectedPlacementId: string | null;
  tool: Tool;
  zoom: number;
  assets: Map<string, SignatureAsset>;
  busy: string | null;
  onPlace(options: {
    tool: Tool;
    x: number;
    y: number;
    pageWidth: number;
    pageHeight: number;
  }): void;
  onSelect(id: string | null): void;
  onUpdatePlacement(id: string, updater: (placement: Placement) => Placement): void;
  onOpenPdf(): void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1000, height: 700 });
  const [pageMetrics, setPageMetrics] = useState({
    widthPx: 0,
    heightPx: 0,
    widthPts: 0,
    heightPts: 0,
    scale: 1,
  });
  const interactionRef = useRef<{
    id: string;
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    placement: Placement;
  } | null>(null);
  const hasDocument = props.pageCount > 0 || Boolean(props.documentName);

  useEffect(() => {
    if (!frameRef.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setFrameSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!props.pdfDoc || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    props.pdfDoc.getPage(props.pageIndex + 1)
      .then(async (page) => {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = fitPageScale(
          baseViewport.width,
          baseViewport.height,
          frameSize.width,
          frameSize.height,
        ) * props.zoom;

        const rendered = await renderPdfPageToCanvas(page, canvasRef.current!, scale);
        if (!cancelled) {
          setPageMetrics({
            ...rendered,
            scale,
          });
        }
      })
      .catch(() => {
        /* handled by parent via toasts when applicable */
      });

    return () => {
      cancelled = true;
    };
  }, [frameSize.height, frameSize.width, props.pageIndex, props.pdfDoc, props.zoom]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current;
      if (
        !interaction ||
        interaction.pointerId !== event.pointerId ||
        !pageMetrics.widthPts ||
        !pageMetrics.heightPts
      ) {
        return;
      }
      const dx = (event.clientX - interaction.startX) / pageMetrics.scale;
      const dy = (event.clientY - interaction.startY) / pageMetrics.scale;
      props.onUpdatePlacement(interaction.id, (placement) => {
        if (interaction.mode === "move") {
          const width = interaction.placement.x1 - interaction.placement.x0;
          const height = interaction.placement.y1 - interaction.placement.y0;
          const x0 = clamp(interaction.placement.x0 + dx, 0, pageMetrics.widthPts - width);
          const y0 = clamp(interaction.placement.y0 + dy, 0, pageMetrics.heightPts - height);
          return { ...placement, x0, y0, x1: x0 + width, y1: y0 + height };
        }

        const minWidth = 36;
        const currentWidth = Math.max(minWidth, interaction.placement.x1 - interaction.placement.x0 + dx);
        const aspect = (interaction.placement.y1 - interaction.placement.y0) /
          Math.max(interaction.placement.x1 - interaction.placement.x0, 1);
        const width = clamp(currentWidth, minWidth, pageMetrics.widthPts - interaction.placement.x0);
        const height = clamp(width * aspect, minWidth * aspect, pageMetrics.heightPts - interaction.placement.y0);
        return {
          ...placement,
          x1: interaction.placement.x0 + width,
          y1: interaction.placement.y0 + height,
        };
      });
    }

    function onPointerUp(event: PointerEvent) {
      if (!interactionRef.current || interactionRef.current.pointerId === event.pointerId) {
        interactionRef.current = null;
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [pageMetrics.heightPts, pageMetrics.scale, pageMetrics.widthPts, props.onUpdatePlacement]);

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (!pageMetrics.widthPts || !pageMetrics.heightPts) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / pageMetrics.scale, 0, pageMetrics.widthPts);
    const y = clamp((event.clientY - rect.top) / pageMetrics.scale, 0, pageMetrics.heightPts);
    if (props.tool === "select") {
      props.onSelect(null);
      return;
    }
    props.onPlace({
      tool: props.tool,
      x,
      y,
      pageWidth: pageMetrics.widthPts,
      pageHeight: pageMetrics.heightPts,
    });
  }

  const stageCursor =
    props.tool === "select"
      ? "cursor-default"
      : props.tool === "text"
      ? "cursor-text"
      : "cursor-crosshair";

  const placementHint =
    props.tool === "select"
      ? "Select mode"
      : props.tool === "text"
      ? "Click to place text"
      : `Click to place ${props.tool}`;

  if (!props.pdfDoc) {
    return (
      <div className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-canvas-stroke sc-stage-surface shadow-panel",
        props.mobile ? "min-h-[55dvh] p-2" : "h-full min-h-[520px] p-3",
      )}>
        <div className={cn(
          "flex min-h-0 flex-1 items-center justify-center",
          props.mobile ? "p-2" : "p-4",
        )}>
          <div className={cn(
            "w-full max-w-xl rounded-2xl border border-canvas-stroke bg-canvas-paper text-center shadow-float sc-pop-in",
            props.mobile ? "px-5 py-7" : "px-8 py-10",
          )}>
            <div className={cn(
              "mx-auto flex items-center justify-center rounded-2xl bg-canvas-accent-soft text-canvas-accent",
              props.mobile ? "h-12 w-12" : "h-14 w-14",
            )}>
              {props.busy ? (
                <Loader2 className={props.mobile ? "h-6 w-6 animate-spin" : "h-7 w-7 animate-spin"} />
              ) : (
                <FileText className={props.mobile ? "h-6 w-6" : "h-7 w-7"} />
              )}
            </div>
            <div className={cn(
              "font-display leading-tight text-canvas-text",
              props.mobile ? "mt-4 text-[1.5rem]" : "mt-5 text-[2rem]",
            )}>
              {hasDocument ? "Preparing your document..." : "Open a PDF to begin"}
            </div>
            <div className={cn(
              "mx-auto max-w-md leading-6 text-canvas-muted",
              props.mobile ? "mt-2 text-xs" : "mt-3 text-sm",
            )}>
              {hasDocument
                ? "The document is loaded and the stage is getting ready."
                : props.mobile
                ? "Pick a PDF from your device to start signing."
                : "Drop a PDF anywhere on this window, or pick one from your computer."}
            </div>
            {!hasDocument && (
              <div className={cn(
                "flex flex-wrap items-center justify-center gap-2",
                props.mobile ? "mt-5" : "mt-6",
              )}>
                <button
                  className={buttonClassName("solid", Boolean(props.busy))}
                  disabled={Boolean(props.busy)}
                  onClick={props.onOpenPdf}
                >
                  <FileText className="h-4 w-4" />
                  Choose PDF
                </button>
                {!props.mobile && (
                  <div className="text-xs text-canvas-muted">or drag &amp; drop</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col overflow-hidden rounded-2xl border border-canvas-stroke sc-stage-surface shadow-panel",
      props.mobile ? "min-h-[55dvh]" : "h-full min-h-[520px]",
    )}>
      <div className={cn(
        "flex items-center justify-between gap-2 border-b border-canvas-stroke/60 bg-canvas-panel/40",
        props.mobile ? "px-2.5 py-1.5" : "gap-3 px-4 py-2",
      )}>
        {!props.mobile && (
          <div className="min-w-0 text-xs text-canvas-muted">
            Page <span className="font-medium text-canvas-text-soft">{props.pageIndex + 1}</span> of {props.pageCount}
          </div>
        )}
        {props.mobile && props.placements.length === 0 && props.tool === "select" ? (
          <div className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-canvas-accent/50 bg-canvas-accent-soft px-2 py-0.5 text-[0.65rem] font-medium text-canvas-accent-dark">
            <PenLine className="h-3 w-3" />
            Tap <span className="font-semibold">Tools</span> to add a signature
          </div>
        ) : (
          <div className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-canvas-stroke bg-white/75 font-medium text-canvas-muted",
            props.mobile ? "px-2 py-0.5 text-[0.65rem]" : "px-2.5 py-1 text-[0.7rem]",
            props.mobile && "ml-auto",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              props.tool === "select" ? "bg-canvas-muted-2" : "bg-canvas-accent",
            )} />
            {placementHint}
          </div>
        )}
      </div>

      <div
        ref={frameRef}
        className={cn(
          "thin-scrollbar relative min-h-0 flex-1 overflow-auto",
          props.mobile ? "p-2" : "p-3 lg:p-5",
          stageCursor,
        )}
      >
        <div className={cn(
          "mx-auto w-fit rounded-md border border-canvas-stroke bg-canvas-paper shadow-[0_25px_50px_-18px_rgba(60,40,20,0.35),0_6px_12px_-4px_rgba(60,40,20,0.15)]",
          props.mobile ? "p-1" : "p-2",
        )}>
          <div
            className="relative bg-white"
            style={{
              width: pageMetrics.widthPx || undefined,
              height: pageMetrics.heightPx || undefined,
              touchAction: props.tool === "select" ? "none" : "manipulation",
            }}
            onPointerDown={handleStagePointerDown}
          >
            <canvas ref={canvasRef} className="block" />
            {props.placements.map((placement) => (
              <PlacementLayer
                key={placement.id}
                placement={placement}
                selected={props.selectedPlacementId === placement.id}
                asset={placement.assetId ? props.assets.get(placement.assetId) ?? null : null}
                scale={pageMetrics.scale}
                onSelect={() => props.onSelect(placement.id)}
                onPointerDown={(mode, event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  props.onSelect(placement.id);
                  interactionRef.current = {
                    id: placement.id,
                    mode,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    placement,
                  };
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlacementLayer(props: {
  placement: Placement;
  selected: boolean;
  asset: SignatureAsset | null;
  scale: number;
  onSelect(): void;
  onPointerDown(mode: "move" | "resize", event: ReactPointerEvent<HTMLDivElement>): void;
}) {
  const style: CSSProperties = {
    left: props.placement.x0 * props.scale,
    top: props.placement.y0 * props.scale,
    width: (props.placement.x1 - props.placement.x0) * props.scale,
    height: (props.placement.y1 - props.placement.y0) * props.scale,
  };

  return (
    <div
      className={cn(
        "group absolute rounded-[6px] border-2 transition-colors",
        "cursor-move",
        props.selected
          ? "border-canvas-accent/80 bg-[rgba(201,107,44,0.04)]"
          : "border-transparent hover:border-canvas-accent/40 hover:bg-[rgba(201,107,44,0.03)]",
      )}
      style={{ ...style, touchAction: "none" }}
      onPointerDown={(event) => props.onPointerDown("move", event)}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect();
      }}
    >
      <div className={cn(
        "pointer-events-none absolute -top-6 left-0 rounded-md bg-canvas-text px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-label text-white transition",
        props.selected
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100",
      )}>
        {props.placement.kind === "text" ? "Text" : kindLabel(props.placement.kind)}
      </div>
      {props.placement.kind === "text" ? (
        <div
          className="h-full w-full select-none whitespace-pre-wrap break-words px-1.5 py-0.5"
          style={{
            color: props.placement.color,
            fontSize: (props.placement.fontSize ?? 18) * props.scale,
          }}
        >
          {props.placement.text}
        </div>
      ) : props.asset ? (
        <TintedSignatureImage
          dataUrl={props.asset.imageDataUrl}
          color={props.placement.color}
          alt={props.asset.label}
        />
      ) : null}
      {props.selected && props.placement.kind !== "text" && (
        <div
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-sm border-2 border-white bg-canvas-accent shadow-md"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => props.onPointerDown("resize", event)}
        />
      )}
    </div>
  );
}

function TintedSignatureImage(props: { dataUrl: string; color: string; alt: string }) {
  const [src, setSrc] = useState(props.dataUrl);

  useEffect(() => {
    let cancelled = false;
    tintSignatureToPngBytes(props.dataUrl, props.color)
      .then((bytes) => {
        if (!cancelled) {
          setSrc(bytesToDataUrl(bytes, "image/png"));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(props.dataUrl);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.color, props.dataUrl]);

  return <img src={src} alt={props.alt} className="h-full w-full object-fill" draggable={false} />;
}

function ToastStack(props: { toasts: Toast[]; onDismiss(id: string): void }) {
  if (props.toasts.length === 0) {
    return null;
  }
  const mobile = typeof window !== "undefined" && window.innerWidth < 640;
  return (
    <div
      className={cn(
        "pointer-events-none fixed z-50 flex w-auto max-w-sm flex-col gap-2",
        mobile
          ? "inset-x-3 top-[8.75rem]"
          : "inset-x-3 bottom-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-full",
      )}
    >
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto sc-fade-in flex items-start gap-2.5 rounded-xl border bg-white px-3.5 py-2.5 shadow-panel-lg",
            toast.tone === "success" && "border-canvas-success/30",
            toast.tone === "error" && "border-canvas-oxblood/40 bg-[#fff8f5]",
            toast.tone === "info" && "border-canvas-stroke",
          )}
        >
          <div className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            toast.tone === "success" && "bg-canvas-success/15 text-canvas-success",
            toast.tone === "error" && "bg-canvas-oxblood/15 text-canvas-oxblood",
            toast.tone === "info" && "bg-canvas-accent-soft text-canvas-accent-dark",
          )}>
            {toast.tone === "success" ? <Check className="h-3 w-3" strokeWidth={3} /> :
             toast.tone === "error" ? <X className="h-3 w-3" strokeWidth={3} /> : "i"}
          </div>
          <div className="min-w-0 flex-1 text-sm leading-5 text-canvas-text-soft">{toast.message}</div>
          <button
            className="shrink-0 rounded-md p-0.5 text-canvas-muted hover:bg-canvas-panel hover:text-canvas-text"
            onClick={() => props.onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function DrawSignatureModal(props: {
  kind: SignatureKind;
  existingCount: number;
  onClose(): void;
  onSave(asset: SignatureAsset): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#111111";
      context.lineWidth = 4;
    }
  }, []);

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
    }
  }

  function save() {
    if (!canvasRef.current) {
      return;
    }
    try {
      const asset = createAssetFromCanvas(props.kind, canvasRef.current, props.existingCount, "drawn");
      props.onSave(asset);
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  function getCanvasPoint(event: PointerEvent | React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  return (
    <ModalShell title={`Draw ${kindLabel(props.kind).toLowerCase()}`} onClose={props.onClose}>
      <div className="text-sm leading-6 text-canvas-muted">
        Sign with your mouse, trackpad, or stylus. We&#39;ll trim the edges and remove the background.
      </div>
      <div className="relative mt-4">
        <canvas
          ref={canvasRef}
          width={760}
          height={260}
          className="block w-full cursor-crosshair select-none rounded-xl border border-canvas-stroke bg-white shadow-inner-hairline"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            const point = getCanvasPoint(event);
            if (!point) {
              return;
            }
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = point;
            setIsEmpty(false);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current || !canvasRef.current) {
              return;
            }
            event.preventDefault();
            const point = getCanvasPoint(event);
            if (!point) {
              return;
            }
            const context = canvasRef.current.getContext("2d");
            if (!context) {
              return;
            }
            context.beginPath();
            context.moveTo(drawingRef.current.x, drawingRef.current.y);
            context.lineTo(point.x, point.y);
            context.stroke();
            drawingRef.current = point;
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            drawingRef.current = null;
          }}
          onPointerCancel={(event) => {
            event.preventDefault();
            drawingRef.current = null;
          }}
          onPointerLeave={() => {
            drawingRef.current = null;
          }}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center font-display text-2xl italic text-canvas-muted/50">
              Sign above the line
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-dashed border-canvas-stroke" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-canvas-muted">Tip: short strokes look best after trimming.</div>
        <div className="flex gap-2">
          <button className={buttonClassName("ghost")} onClick={clearCanvas}>Clear</button>
          <button className={buttonClassName("soft")} onClick={props.onClose}>Cancel</button>
          <button className={buttonClassName("solid", isEmpty)} disabled={isEmpty} onClick={save}>Save</button>
        </div>
      </div>
    </ModalShell>
  );
}

function TypedSignatureModal(props: {
  kind: SignatureKind;
  existingCount: number;
  onClose(): void;
  onSave(asset: SignatureAsset): void;
}) {
  const [text, setText] = useState(props.kind === "signature" ? "Jane Smith" : "JS");
  const [fontFamily, setFontFamily] = useState<string>(SCRIPT_FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState(props.kind === "signature" ? 92 : 72);

  return (
    <ModalShell title={`Type ${kindLabel(props.kind).toLowerCase()}`} onClose={props.onClose}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <label className="block">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-label text-canvas-muted">Text</div>
            <input
              className="w-full rounded-xl border border-canvas-stroke bg-white px-3.5 py-2.5 text-sm outline-none focus:border-canvas-accent focus:ring-2 focus:ring-canvas-accent/20"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-label text-canvas-muted">Style</div>
            <div className="grid grid-cols-1 gap-1.5">
              {SCRIPT_FONT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2 text-left transition hover:border-canvas-accent",
                    fontFamily === option.value ? "border-canvas-accent ring-2 ring-canvas-accent/20" : "border-canvas-stroke",
                  )}
                  onClick={() => setFontFamily(option.value)}
                >
                  <div className="text-[0.72rem] uppercase tracking-label text-canvas-muted">{option.label}</div>
                  <div style={{ fontFamily: option.value }} className="truncate text-2xl text-canvas-text">
                    {text || "Signature"}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-label text-canvas-muted">Size</div>
              <div className="text-xs tabular-nums text-canvas-muted">{fontSize}pt</div>
            </div>
            <input
              className="mt-2 w-full accent-canvas-accent"
              type="range"
              min={48}
              max={140}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-canvas-stroke bg-canvas-paper p-4 text-center shadow-inner-hairline">
          <div className="text-[0.62rem] font-semibold uppercase tracking-label text-canvas-muted">Preview</div>
          <div className="flex flex-1 items-center justify-center">
            <div style={{ fontFamily, fontSize }} className="max-w-full truncate text-canvas-text">
              {text}
            </div>
          </div>
          <div className="mt-2 border-t border-dashed border-canvas-stroke pt-2 text-[0.62rem] uppercase tracking-label text-canvas-muted">
            {kindLabel(props.kind)}
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className={buttonClassName("soft")} onClick={props.onClose}>Cancel</button>
        <button
          className={buttonClassName("solid", !text.trim())}
          disabled={!text.trim()}
          onClick={async () => {
            try {
              const asset = await createTypedSignatureAsset({
                kind: props.kind,
                text,
                fontFamily,
                fontSize,
                existingCount: props.existingCount,
              });
              props.onSave(asset);
            } catch (error) {
              window.alert((error as Error).message);
            }
          }}
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function FinalizeModal(props: {
  placementCount: number;
  busy: boolean;
  documentName: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const fileName = props.documentName.replace(/\.pdf$/i, "") + "_signed.pdf";
  return (
    <ModalShell title="Export signed PDF" onClose={props.onCancel}>
      <div className="flex items-center gap-3 rounded-xl border border-canvas-stroke bg-canvas-paper p-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas-accent-soft text-canvas-accent">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-canvas-text">{fileName}</div>
          <div className="mt-0.5 text-xs text-canvas-muted">
            {props.placementCount} placement{props.placementCount === 1 ? "" : "s"} · Original PDF untouched
          </div>
        </div>
      </div>
      <div className="mt-3 text-sm leading-6 text-canvas-muted">
        A new signed copy will be saved alongside the original so you can review both.
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={buttonClassName("soft", props.busy)} disabled={props.busy} onClick={props.onCancel}>Cancel</button>
        <button className={buttonClassName("solid", props.busy || props.placementCount === 0)} disabled={props.busy || props.placementCount === 0} onClick={props.onConfirm}>
          {props.busy ? (<><Loader2 className="h-4 w-4 animate-spin" />Exporting...</>) : (<><Download className="h-4 w-4" />Export PDF</>)}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell(props: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6 sc-fade-in">
      <div className="absolute inset-0 bg-[rgba(42,33,28,0.45)] backdrop-blur-sm" onClick={props.onClose} />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[24px] border border-canvas-stroke bg-canvas-panel shadow-panel-lg sc-pop-in sm:rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-canvas-stroke px-5 py-3">
          <div className="font-display text-[1.5rem] font-semibold text-canvas-text">{props.title}</div>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-canvas-muted transition hover:bg-white hover:text-canvas-text"
            onClick={props.onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[78dvh] overflow-y-auto p-4 sm:max-h-[85vh] sm:p-5">{props.children}</div>
      </div>
    </div>
  );
}

export default App;
