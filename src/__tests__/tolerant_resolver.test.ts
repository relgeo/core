import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";

describe("Tolerant Resolver (Editor Mode)", () => {
    it("should not crash when resolving incomplete rect in editor mode", () => {
        const yaml = `
version: 0.2
objects:
  r:
    type: rect
`;
        const doc = parseRelGeo(yaml, { mode: "editor" });
        expect(() => resolveGeometry(doc, { mode: "editor" })).not.toThrow();
        
        const scene = resolveGeometry(doc, { mode: "editor" });
        expect(scene.objects.r).toBeDefined();
        expect((scene.objects.r as any).width).toBe(0);
    });

    it("should throw machine-readable error in compile mode for missing size", () => {
        const yaml = `
version: 0.2
objects:
  r:
    type: rect
`;
        const doc = parseRelGeo(yaml, { mode: "editor" });
        expect(() => resolveGeometry(doc, { mode: "compile" })).toThrow(/MISSING_REQUIRED_FIELD/);
    });
});
