import { afterEach, describe, expect, it } from "vitest";

import { useEditorStore } from "./editor-store";

function resetState() {
  useEditorStore.setState({
    document: null,
    tool: "signature",
    zoom: 1,
    placementsByPage: {},
    assets: {
      signature: [],
      initials: [],
    },
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
  });
}

describe("editor store asset state", () => {
  afterEach(() => {
    resetState();
  });

  it("hydrates the first available asset as active", () => {
    resetState();
    const store = useEditorStore.getState();
    store.setAssets({
      signature: [
        {
          id: "sig-1",
          kind: "signature",
          source: "typed",
          label: "Typed Signature",
          imageDataUrl: "data:image/png;base64,AA==",
          inkPreviewColor: "#111111",
          width: 100,
          height: 40,
        },
      ],
      initials: [],
    });

    expect(useEditorStore.getState().activeAssetIds.signature).toBe("sig-1");
  });

  it("moves the active asset to the newest saved asset", () => {
    resetState();
    const store = useEditorStore.getState();
    store.upsertAsset({
      id: "sig-1",
      kind: "signature",
      source: "drawn",
      label: "Signature 1",
      imageDataUrl: "data:image/png;base64,AA==",
      inkPreviewColor: "#111111",
      width: 120,
      height: 42,
    });
    store.upsertAsset({
      id: "sig-2",
      kind: "signature",
      source: "typed",
      label: "Typed Signature",
      imageDataUrl: "data:image/png;base64,AA==",
      inkPreviewColor: "#111111",
      width: 140,
      height: 54,
    });

    expect(useEditorStore.getState().activeAssetIds.signature).toBe("sig-2");
  });

  i