import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument } from "../types";

const mockTextMetrics = {
    measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
    measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("Smart Placement & Custom Anchors", () => {

    const boltComponentDef = {
        parameters: { diameter: 4, length: 12 },
        objects: {
            head: { type: "circle", center: [0, 0], radius: "diameter * 1.5" },
            shaft: { type: "line", from: [0, 0], to: [0, "length"], width: "diameter" }
        },
        exports: {
            centerPoint: "head.center",
            tip: "shaft.end"
        }
    } as any;

    it("should place component using custom exported anchor in on.point", () => {
        const doc: RelGeoDocument = {
            version: 0.4,
            scene: { unit: "px" },
            components: { bolt: boltComponentDef },
            objects: {
                target_pt: { type: "point", at: [100, 150] },
                my_bolt: {
                    type: "component",
                    use: "bolt",
                    on: {
                        point: { at: "target_pt", anchor: "centerPoint" }
                    }
                }
            }
        };

        const result = resolveGeometry(doc as any, { textMetrics: mockTextMetrics as any });
        const obj = result.objects["my_bolt"] as any;

        expect(obj).toBeDefined();
        // Since the origin of the component is [0,0] and centerPoint is [0,0],
        // the translation applied should be exactly the target_pt
        expect(obj.transform).toBeDefined();
        expect(obj.transform[0].type).toBe("translate");
        expect(obj.transform[0].x).toBe(100);
        expect(obj.transform[0].y).toBe(150);
    });

    it("should place component using custom exported anchor in place mapping", () => {
        const doc: RelGeoDocument = {
            version: 0.4,
            scene: { unit: "px" },
            components: { bolt: boltComponentDef },
            objects: {
                target_pt: { type: "point", at: [200, 300] },
                my_bolt: {
                    type: "component",
                    use: "bolt",
                    place: { centerPoint: "target_pt" }
                }
            }
        };

        const result = resolveGeometry(doc as any, { textMetrics: mockTextMetrics as any });
        const obj = result.objects["my_bolt"] as any;

        expect(obj).toBeDefined();
        expect(obj.transform).toBeDefined();
        expect(obj.transform[0].type).toBe("translate");
        expect(obj.transform[0].x).toBe(200);
        expect(obj.transform[0].y).toBe(300);
    });

    it("should transform (rotate) component around its custom anchor origin", () => {
        const doc: RelGeoDocument = {
            version: 0.4,
            scene: { unit: "px" },
            components: { bolt: boltComponentDef },
            objects: {
                target_pt: { type: "point", at: [50, 50] },
                my_bolt: {
                    type: "component",
                    use: "bolt",
                    on: {
                        point: { at: "target_pt", anchor: "centerPoint" }
                    },
                    transform: [
                        { rotate: { angle: "45deg", origin: "tip" } }
                    ]
                }
            }
        };

        const result = resolveGeometry(doc as any, { textMetrics: mockTextMetrics as any });
        const obj = result.objects["my_bolt"] as any;

        expect(obj).toBeDefined();
        expect(obj.transform.length).toBe(2);
        
        // 1st transform is translate from `on` placement
        expect(obj.transform[0].type).toBe("translate");
        expect(obj.transform[0].x).toBe(50);
        expect(obj.transform[0].y).toBe(50);

        // 2nd transform is rotate from user
        expect(obj.transform[1].type).toBe("rotate");
        expect(obj.transform[1].angle).toBe(45);
        // "tip" anchor is shaft.end, which is [0, length]. length=12 default.
        // The rotation origin should have been resolved to [0, 12] relative to the unplaced component coordinates.
        expect(obj.transform[1].origin).toBeDefined();
        expect(obj.transform[1].origin.x).toBe(0);
        expect(obj.transform[1].origin.y).toBe(12);
    });

});
