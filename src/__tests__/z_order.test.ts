import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";

describe("Z-Order Consistency", () => {
  it("should preserve declaration order in the final output regardless of resolution order", () => {
    // rumah depends on tanah, but rumah is declared first
    const yaml = `
version: 0.1
objects:
  rumah:
    type: rect
    size: [50, 50]
    place: { center: tanah.center }
  tanah:
    type: rect
    size: [100, 100]
    place: { left: 0, top: 0 }
`;
    const doc = parseRelGeo(yaml);
    const resolved = resolveGeometry(doc);
    
    // The keys in the final objects should be [rumah, tanah] (declaration order)
    const keys = Object.keys(resolved.objects);
    expect(keys).toEqual(["rumah", "tanah"]);

    // But they should be correctly resolved (rumah center = tanah center)
    const rumah = resolved.objects.rumah as any;
    const tanah = resolved.objects.tanah as any;
    
    expect(tanah.x).toBe(0);
    expect(tanah.y).toBe(0);
    expect(rumah.x).toBe(25); // (100-50)/2
    expect(rumah.y).toBe(25);
  });
});
