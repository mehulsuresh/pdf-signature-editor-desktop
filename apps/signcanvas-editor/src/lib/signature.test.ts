import { describe, expect, it } from "vitest";

import { buildAssetLabel } from "./signature";

describe("signature labels", () => {
  it("labels typed signatures clearly", () => {
    expect(buildAssetLabel("signature", 0, "typed")).toBe("Typed Signature");
    expect(buildAssetLabel("initials", 0, "typed")).toBe("Typed Initials");
  });

  it("numbers drawn assets", () => {
    expect(buildAssetLabel("signature", 2, "drawn")).toBe("Signature 3");
  });
});
