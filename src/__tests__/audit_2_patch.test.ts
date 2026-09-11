import { describe, it, expect } from "vitest";
import { resolvePath, resolvePolygon, resolveArc, resolveQuadratic, resolveCubic } from "../resolver/primitives/shapes";
import { ResolveContext } from "../resolver/types";

const mockCtx: ResolveContext = {
    scalars: {},
    objects: {},
    targetUnit: "mm",
    mode: "compile",
    textMetrics: {
        measure: () => ({ width: 10, height: 10, ascent: 8, descent: 2 })
    }
};

describe("Audit 2 Patch Verification", () => {
    it("should support placement for polygon", () => {
        const obj: any = {
            type: "polygon",
            points: [[0, 0], [10, 0], [10, 10], [0, 10]],
            place: { left: 100, top: 100 }
        };
        const resolved = resolvePolygon("poly1", obj, mockCtx);
        
        expect(resolved.points[0].x).toBe(100);
        expect(resolved.points[0].y).toBe(100);
        expect(resolved.points[2].x).toBe(110);
        expect(resolved.points[2].y).toBe(110);
    });

    it("should support corner + placement for polygon", () => {
        const obj: any = {
            type: "polygon",
            points: [[0, 0], [100, 0], [100, 100], [0, 100]],
            corner: { all: { fillet: 10 } },
            place: { center: [0, 0] }
        };
        const resolved = resolvePolygon("poly2", obj, mockCtx);
        
        expect(resolved.points[0].x).toBeCloseTo(-40);
        expect(resolved.points[0].y).toBeCloseTo(-50);
    });

    it("should not mutate raw object holes in resolvePath", () => {
        const obj: any = {
            type: "path",
            segments: [{ line: { from: [0,0], to: [100,100] } }],
            holes: [
                { segments: [
                    { line: { from: [10,10], to: [20,10] } },
                    { line: { to: [20,20] } },
                    { line: { to: [10,20] } },
                    { line: { to: [10,10] } }
                ] }
            ]
        };
        
        const objCopy = JSON.parse(JSON.stringify(obj));
        resolvePath("path1", obj, mockCtx);
        
        expect((obj as any)._resolvedHoles).toBeUndefined();
        expect(obj).toEqual(objCopy);
    });

    it("should support placement for arc", () => {
        const obj: any = {
            type: "arc",
            from: [0,0],
            through: [50, 50],
            to: [100, 0],
            place: { left: 1000 }
        };
        const resolved = resolveArc("arc1", obj, mockCtx);
        expect(resolved.x1).toBe(1000);
    });

    it("should support placement for quadratic", () => {
        const obj: any = {
            type: "quadratic",
            from: [0,0],
            cp: [50, 100],
            to: [100, 0],
            place: { top: 500 }
        };
        const resolved = resolveQuadratic("q1", obj, mockCtx);
        expect(resolved.y1).toBe(500);
    });

    it("should support placement for cubic", () => {
        const obj: any = {
            type: "cubic",
            from: [0,0],
            cp1: [25, 50],
            cp2: [75, 50],
            to: [100, 0],
            place: { left: 200 }
        };
        const resolved = resolveCubic("c1", obj, mockCtx);
        expect(resolved.x1).toBe(200);
    });
});
