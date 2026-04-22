import { describe, expect, it } from "vitest";

import { fitPageScale, guessMimeType, pixelsToPoints, pointsToPixels } from "./utils";

describe("coordinate helpers", () => {
  it("round-trips points and pixels at the same scale", () => {
    const points = 144;
    const scale = 1.75;
    const pixels = pointsToPixels(points, scale);
    expect(pixelsToPoints(pixels, scale)).toBeCloseTo(points, 5);
  });

  it("fits a page into an editor frame", () => {
    const scale = fitPageScale(612, 792, 1200, 900);
    expect(scale).toBeGreaterThan(0.5);
    expect(scale).toBeLessThanOrEqual(2);
  });

  it("guesses common file mime types", () => {
    expect(guessMimeType("mark.jpg")).toBe("image/jpeg");
    expect(guessMimeType("mark.webp")).toBe("image/webp");
    expect(guessMimeType("mark.bmp")).toBe("image/bmp");
    expect(guessMimeType("contract.pdf")).toBe("application/pdf");
    expect(guessMimeType("mark.png")).toBe("image/png");
  });
});
