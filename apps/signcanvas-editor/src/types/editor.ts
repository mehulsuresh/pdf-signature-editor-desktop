export type SignatureKind = "signature" | "initials";
export type Tool = SignatureKind | "text" | "select";
export type AssetSource = "drawn" | "typed" | "imported";

export interface EditorDocument {
  name: string;
  originalBytes: Uint8Array;
  pageCount: number;
  currentPageIndex: number;
}

export interface SignatureAsset {
  id: string;
  kind: SignatureKind;
  source: AssetSource;
  label: string;
  imageDataUrl: string;
  inkPreviewColor: string;
  width: number;
  height: number;
}

export interface Placement {
  id: string;
  pageIndex: number;
  kind: SignatureKind | "text";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  assetId?: string;
  text?: string;
  fontSize?: number;
}

export interface PlacementSize {
  width: number;
  height: number;
}

export interface SignatureAssetStore {
  signature: SignatureAsset[];
  initials: SignatureAsset[];
}

export interface UiPanels {
  drawKind: SignatureKind | null;
  typedKind: SignatureKind | null;
  finalizeOpen: boolean;
}

export interface EditorStateShape {
  document: EditorDocument | null;
  tool: Tool;
  zoom: number;
  placementsByPage: Record<number, Placement[]>;
  assets: SignatureAssetStore;
  activeAssetIds: Record<SignatureKind, string | null>;
  selectedPlacementId: string | null;
  ui: UiPanels;
  draftText: string;
  draftTextSize: number;
  draftInkColor: string;
  lastPlacementSize: Record<SignatureKind, PlacementSize | null>;
}
