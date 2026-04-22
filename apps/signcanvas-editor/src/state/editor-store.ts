import { create } from "zustand";

import type {
  EditorDocument,
  EditorStateShape,
  Placement,
  SignatureAsset,
  SignatureAssetStore,
  SignatureKind,
  Tool,
} from "../types/editor";

const INITIAL_ASSETS: SignatureAssetStore = {
  signature: [],
  initials: [],
};

interface EditorActions {
  setDocument(document: EditorDocument | null): void;
  setAssets(store: SignatureAssetStore): void;
  upsertAsset(asset: SignatureAsset): void;
  removeAsset(kind: SignatureKind, id: string): void;
  setTool(tool: Tool): void;
  setActiveAsset(kind: SignatureKind, id: string): void;
  setZoom(zoom: number): void;
  setDraftText(value: string): void;
  setDraftTextSize(value: number): void;
  setDraftInkColor(value: string): void;
  setSelectedPlacement(id: string | null): void;
  addPlacement(placement: Placement): void;
  updatePlacement(id: string, updater: (placement: Placement) => Placement): void;
  deleteSelectedPlacement(): void;
  setPage(index: number): void;
  openDrawModal(kind: SignatureKind | null): void;
  openTypedModal(kind: SignatureKind | null): void;
  openFinalize(open: boolean): void;
}

type EditorStore = EditorStateShape & EditorActions;

export const useEditorStore = create<EditorStore>((set, get) => ({
  document: null,
  tool: "signature",
  zoom: 1,
  placementsByPage: {},
  assets: INITIAL_ASSETS,
  activeAssetIds: {
    signature: null,
    initials: null,
  },
  selectedPlacementId: null,
  ui: {
    drawKind: null,
    typedKind: null,
    finalizeOpen: false,
  },
  draftText: "Approved",
  draftTextSize: 18,
  draftInkColor: "#111111",
  lastPlacementSize: {
    signature: null,
    initials: null,
  },
  setDocument(document) {
    set({
      document,
      placementsByPage: {},
      selectedPlacementId: null,
      zoom: 1,
    });
  },
  setAssets(store) {
    set((state) => ({
      assets: store,
      activeAssetIds: {
        signature: store.signature.some((asset) => asset.id === state.activeAssetIds.signature)
          ? state.activeAssetIds.signature
          : (store.signature[0]?.id ?? null),
        initials: store.initials.some((asset) => asset.id === state.activeAssetIds.initials)
          ? state.activeAssetIds.initials
          : (store.initials[0]?.id ?? null),
      },
    }));
  },
  upsertAsset(asset) {
    set((state) => {
      const existing = state.assets[asset.kind];
      const next = existing.some((item) => item.id === asset.id)
        ? existing.map((item) => (item.id === asset.id ? asset : item))
        : [asset, ...existing];
      return {
        assets: {
          ...state.assets,
          [asset.kind]: next,
        },
        activeAssetIds: {
          ...state.activeAssetIds,
          [asset.kind]: asset.id,
        },
      };
    });
  },
  removeAsset(kind, id) {
    set((state) => {
      const remainingAssets = state.assets[kind].filter((asset) => asset.id !== id);
      const activeId = state.activeAssetIds[kind];
      const nextPlacementsByPage = Object.fromEntries(
        Object.entries(state.placementsByPage).map(([pageIndex, placements]) => [
          pageIndex,
          placements.filter((placement) => placement.assetId !== id),
        ]),
      );
      const removedSelectedPlacement = Object.values(state.placementsByPage)
        .flat()
        .some((placement) => placement.id === state.selectedPlacementId && placement.assetId === id);

      return {
        assets: {
          ...state.assets,
          [kind]: remainingAssets,
        },
        activeAssetIds: {
          ...state.activeAssetIds,
          [kind]: activeId === id ? (remainingAssets[0]?.id ?? null) : activeId,
        },
        placementsByPage: nextPlacementsByPage,
        selectedPlacementId: removedSelectedPlacement ? null : state.selectedPlacementId,
      };
    });
  },
  setTool(tool) {
    set({ tool });
  },
  setActiveAsset(kind, id) {
    set((state) => ({
      activeAssetIds: {
        ...state.activeAssetIds,
        [kind]: id,
      },
    }));
  },
  setZoom(zoom) {
    set({ zoom });
  },
  setDraftText(value) {
    set({ draftText: value });
  },
  setDraftTextSize(value) {
    set({ draftTextSize: value });
  },
  setDraftInkColor(value) {
    set({ draftInkColor: value });
  },
  setSelectedPlacement(id) {
    set({ selectedPlacementId: id });
  },
  addPlacement(placement) {
    set((state) => {
      const pagePlacements = state.placementsByPage[placement.pageIndex] ?? [];
      const nextLastPlacementSize = placement.kind === "text"
        ? state.lastPlacementSize
        : {
            ...state.lastPlacementSize,
            [placement.kind]: {
              width: placement.x1 - placement.x0,
              height: placement.y1 - placement.y0,
            },
          };
      return {
        placementsByPage: {
          ...state.placementsByPage,
          [placement.pageIndex]: [...pagePlacements, placement],
        },
        selectedPlacementId: placement.id,
        tool: "select",
        lastPlacementSize: nextLastPlacementSize,
      };
    });
  },
  updatePlacement(id, updater) {
    set((state) => {
      const placementsByPage = Object.fromEntries(
        Object.entries(state.placementsByPage).map(([pageIndex, placements]) => [
          pageIndex,
          placements.map((placement) => (placement.id === id ? updater(placement) : placement)),
        ]),
      );
      const selected = Object.values(placementsByPage).flat().find((placement) => placement.id === id);
      const nextLastPlacementSize = selected && selected.kind !== "text"
        ? {
            ...state.lastPlacementSize,
            [selected.kind]: {
              width: selected.x1 - selected.x0,
              height: selected.y1 - selected.y0,
            },
          }
        : state.lastPlacementSize;
      return { placementsByPage,