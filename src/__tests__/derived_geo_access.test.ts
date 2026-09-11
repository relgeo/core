import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument } from "../types";

describe("Derived: Object Property Access", () => {
    it("should resolve derived: totalLen = length(curve)", () => {
        const doc: RelGeoDocument = {
            version: "0.4",
            objects: {
                curve: { type: "line", from: [0, 0] as [number, number], to: [100, 0] as [number, number] }
            },
            derived: {
                totalLen: "length(curve)"
            }
        };
        const scene = resolveGeometry(doc);
        expect(scene.values.totalLen).toBeCloseTo(100);
    });

    it("should resolve derived: fPoint = frameAt(curve, 0.25).point", () => {
        const doc: RelGeoDocument = {
            version: "0.4",
            objects: {
                curve: { type: "line", from: [0, 0] as [number, number], to: [100, 0] as [number, number] }
            },
            derived: {
                fPoint: "frameAt(curve, 0.25).point"
            }
        };
        const scene = resolveGeometry(doc);
        const pt = scene.values.fPoint as unknown as { x: number; y: number };
        expect(pt.x).toBeCloseTo(25);
        expect(pt.y).toBeCloseTo(0);
    });

    it("should allow ObjectA → d1 → ObjectB chain", () => {
        // ObjectA (line 80px) → lineLen = length(lineA) → boxB (rect with size lineLen x lineLen)
        const doc: RelGeoDocument = {
            version: "0.4",
            objects: {
                lineA: { type: "line", from: [0, 0] as [number, number], to: [80, 0] as [number, number] },
                boxB: {
                    type: "rect",
                    size: ["lineLen", "lineLen"] as [string, string]
                }
            },
            derived: {
                lineLen: "length(lineA)"
            }
        };
        const scene = resolveGeometry(doc);
        expect(scene.values.lineLen).toBeCloseTo(80);
        const box = scene.objects.boxB as any;
        expect(box.width).toBeCloseTo(80);
        expect(box.height).toBeCloseTo(80);
    });

    it("should allow pure scalar derived (backward compat)", () => {
        const doc: RelGeoDocument = {
            version: "0.4",
            objects: {
                box: {
                    type: "rect",
                    size: ["margin", "margin"] as [string, string]
                }
            },
            derived: {
                margin: "20"
            }
        };
        const scene = resolveGeometry(doc);
        expect(scene.values.margin).toBe(20);
        const box = scene.objects.box as any;
        expect(box.width).toBeCloseTo(20);
    });

    it("should throw CIRCULAR_DEPENDENCY when derived and object form a cycle", () => {
        // d1 references objA, objA.size references d1 → cycle: d1 → objA → d1
        const doc: RelGeoDocument = {
            version: "0.4",
            objects: {
                objA: {
                    type: "rect",
                    size: ["d1", "10"] as [string, string]
                }
            },
            derived: {
                d1: "length(objA)"
            }
        };
        expect(() => resolveGeometry(doc)).toThrow("CIRCULAR_DEPENDENCY");
    });
});

