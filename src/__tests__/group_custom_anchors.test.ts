import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";

describe("Group Custom Anchors", () => {
    it("should resolve custom anchors on group objects based on children bbox", () => {
        const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [P]
    anchors:
      hook: ["50%", "50%"]
  P:
    type: point
    at: [100, 200]
`;
        const doc = parseRelGeo(yaml);
        const scene = resolveGeometry(doc);
        
        // G's bbox should be based on P [100, 200]
        // hook at 50%, 50% should be at [100, 200]
        const G = scene.objects.G as any;
        expect(G.anchors.hook).toEqual({ x: 100, y: 200 });
    });

    it("should resolve relative custom anchors on groups with multiple children", () => {
        const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [P1, P2]
    anchors:
      center_hook: ["50%", "50%"]
  P1: { type: point, at: [0, 0] }
  P2: { type: point, at: [100, 100] }
`;
        const doc = parseRelGeo(yaml);
        const scene = resolveGeometry(doc);
        
        // G's bbox: x:0, y:0, w:100, h:100
        // hook at 50%, 50% => [50, 50]
        const G = scene.objects.G as any;
        expect(G.anchors.center_hook).toEqual({ x: 50, y: 50 });
    });

    it("should use a custom group anchor as a placement target", () => {
        const scene = resolveGeometry({
            version: 0.5,
            objects: {
                G: {
                    type: "group",
                    children: ["P"],
                    anchors: { hook: ["50%", "50%"] },
                    place: { hook: [100, 100] },
                },
                P: { type: "point", at: [0, 0] },
            },
        } as any);

        const group = scene.objects.G as any;
        expect(group.anchors.hook).toEqual({ x: 0, y: 0 });
        expect(group.transform).toEqual([{ type: "translate", x: 100, y: 100 }]);
    });

    it("should reject mixing a custom anchor placement with a standard placement", () => {
        expect(() => resolveGeometry({
            version: 0.5,
            objects: {
                G: {
                    type: "group",
                    children: ["P"],
                    anchors: { hook: ["50%", "50%"] },
                    place: { hook: [100, 100], left: 0 },
                },
                P: { type: "point", at: [0, 0] },
            },
        } as any)).toThrow("OVER_CONSTRAINED");
    });
});
