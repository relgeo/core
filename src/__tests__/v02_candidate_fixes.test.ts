import { describe, it, expect } from "vitest";
import { parseRelGeo, parseForEditor } from "../parser";
import { resolveGeometry } from "../resolver";

describe("Final v0.2 Candidate Fixes", () => {
    it("should resolve rect.bottom correctly (y + height)", () => {
        const yaml = `
version: 0.2
objects:
  tanah: { type: rect, size: [100, 50], place: { left: 0, top: 10 } }
  rumah: { type: rect, size: [20, 20], place: { left: 0, top: tanah.bottom } }
`;
        const doc = parseRelGeo(yaml);
        const scene = resolveGeometry(doc);
        
        // tanah.bottom = y(10) + height(50) = 60
        expect((scene.objects.rumah as any).y).toBe(60);
    });

    it("should reject scalar offset for point alignment in v0.2", () => {
        const yaml = `
version: 0.2
objects:
  A: { type: point, at: [100, 100] }
  B: { type: point, at: [90, 90] }
constraints:
  - align:
      target: B
      with: A
      offset: 10
`;
        expect(() => parseRelGeo(yaml)).toThrow(/offset scalar is not allowed for point anchor in v0.2/);
    });

    it("should be editor-safe for group and path without children/points", () => {
        const yaml = `
version: 0.2
objects:
  g: { type: group }
  p: { type: path }
`;
        const doc = parseForEditor(yaml);
        expect(() => resolveGeometry(doc, { mode: "editor" })).not.toThrow();
        
        const scene = resolveGeometry(doc, { mode: "editor" });
        expect(scene.objects.g).toBeDefined();
        expect(scene.objects.p).toBeDefined();
    });
});
