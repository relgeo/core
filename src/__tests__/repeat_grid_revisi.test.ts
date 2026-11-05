import { describe, it, expect } from "vitest";
import { parseRelGeo, resolveGeometry } from "../index";

function xy(scene: { objects: Record<string, unknown> }, id: string): { x: number; y: number } {
    return scene.objects[id] as { x: number; y: number };
}

describe("Repeat Grid Layout Semantics (Revisi 2026-06-01)", () => {
    it("should throw INVALID_GRID_SPACING when both pitch and gap are defined", () => {
        const yaml = `
version: 0.1
objects:
  grid_obj:
    type: repeat
    grid:
      rows: 2
      cols: 2
      pitch: 10
      gap: 5
    item:
      type: rect
      size: [10, 10]
`;
        expect(() => {
            const doc = parseRelGeo(yaml, { mode: "validate" });
            resolveGeometry(doc);
        }).toThrow(/grid.pitch and grid.gap are mutually exclusive/);
    });

    it("should throw OVER_CONSTRAINED_REPEAT_LAYOUT when auto-layout is active and item has place", () => {
        const yaml = `
version: 0.1
objects:
  grid_obj:
    type: repeat
    grid:
      rows: 2
      cols: 2
      pitch: 10
    item:
      type: rect
      size: [10, 10]
      place:
        center: [0, 0]
`;
        expect(() => {
            const doc = parseRelGeo(yaml, { mode: "validate" });
            resolveGeometry(doc);
        }).toThrow(/item placement is not allowed when grid auto-layout is active/);
    });

    it("should reject negative pitch and non-finite gap at resolve time", () => {
        const negativePitch = {
            version: 0.5,
            objects: {
                grid_obj: {
                    type: "repeat",
                    grid: { rows: 1, cols: 2, pitch: -10 },
                    item: { type: "rect", size: [5, 5] },
                },
            },
        } as any;
        expect(() => resolveGeometry(negativePitch, { mode: "editor" })).toThrow(/grid pitch must contain finite positive lengths/);

        const nonFiniteGap = {
            version: 0.5,
            objects: {
                grid_obj: {
                    type: "repeat",
                    grid: { rows: 1, cols: 2, gap: Number.POSITIVE_INFINITY },
                    item: { type: "rect", size: [5, 5] },
                },
            },
        } as any;
        expect(() => resolveGeometry(nonFiniteGap, { mode: "editor" })).toThrow(/grid gap must contain finite non-negative lengths/);
    });

    it("should handle Manual Layout (no pitch, no gap) without modifying coordinates", () => {
        const yaml = `
version: 0.1
objects:
  grid_obj:
    type: repeat
    grid:
      rows: 2
      cols: 2
    item:
      type: rect
      size: [10, 10]
      place:
        topLeft: [col * 20, row * 20]
`;
        const doc = parseRelGeo(yaml, { mode: "validate" });
        const scene = resolveGeometry(doc);
        
        expect(xy(scene, "grid_obj[0,0]").x).toBe(0);
        expect(xy(scene, "grid_obj[0,0]").y).toBe(0);
        
        expect(xy(scene, "grid_obj[0,1]").x).toBe(20);
        expect(xy(scene, "grid_obj[0,1]").y).toBe(0);

        expect(xy(scene, "grid_obj[1,1]").x).toBe(20);
        expect(xy(scene, "grid_obj[1,1]").y).toBe(20);
    });

    it("should handle Auto Layout (Pitch)", () => {
        const yaml = `
version: 0.1
objects:
  grid_obj:
    type: repeat
    grid:
      rows: 2
      cols: 3
      pitch: [20, 15]
    item:
      type: rect
      size: [10, 10]
`;
        const doc = parseRelGeo(yaml, { mode: "validate" });
        const scene = resolveGeometry(doc);
        
        expect(xy(scene, "grid_obj[0,0]").x).toBe(0);
        expect(xy(scene, "grid_obj[0,0]").y).toBe(0);
        
        expect(xy(scene, "grid_obj[0,2]").x).toBe(40);
        expect(xy(scene, "grid_obj[0,2]").y).toBe(0);

        expect(xy(scene, "grid_obj[1,2]").x).toBe(40);
        expect(xy(scene, "grid_obj[1,2]").y).toBe(15);
    });

    it("should handle Auto Layout (Gap) with variable sizes", () => {
        const yaml = `
version: 0.1
objects:
  grid_obj:
    type: repeat
    grid:
      rows: 2
      cols: 3
      gap: 5
    item:
      type: rect
      # Variable width based on column
      size: ["col == 0 ? 10 : (col == 1 ? 20 : 8)", "row == 0 ? 10 : 15"]
`;
        const doc = parseRelGeo(yaml, { mode: "validate" });
        const scene = resolveGeometry(doc);
        
        // Track width:
        // Col 0: max(10, 10) = 10
        // Col 1: max(20, 20) = 20
        // Col 2: max(8, 8) = 8
        // Track height:
        // Row 0: max(10, 10, 10) = 10
        // Row 1: max(15, 15, 15) = 15
        
        expect(xy(scene, "grid_obj[0,0]").x).toBe(0);
        expect(xy(scene, "grid_obj[0,0]").y).toBe(0);
        
        // Col 1 -> width of Col 0 (10) + gap (5) = 15
        expect(xy(scene, "grid_obj[0,1]").x).toBe(15);
        expect(xy(scene, "grid_obj[0,1]").y).toBe(0);
        
        // Col 2 -> width of Col 0 (10) + gap (5) + width of Col 1 (20) + gap (5) = 40
        expect(xy(scene, "grid_obj[0,2]").x).toBe(40);
        expect(xy(scene, "grid_obj[0,2]").y).toBe(0);

        // Row 1 -> height of Row 0 (10) + gap (5) = 15
        expect(xy(scene, "grid_obj[1,2]").x).toBe(40);
        expect(xy(scene, "grid_obj[1,2]").y).toBe(15);
    });

    it("should handle Collection-Level placement (repeat object itself has place)", () => {
        const yaml = `
version: 0.1
objects:
  target:
    type: rect
    size: [100, 100]
  grid_obj:
    type: repeat
    place:
      topLeft: target.center
    grid:
      rows: 2
      cols: 2
      pitch: 10
    item:
      type: rect
      size: [5, 5]
`;
        const doc = parseRelGeo(yaml, { mode: "validate" });
        const scene = resolveGeometry(doc);
        
        // Target center is at [50, 50]
        // The grid before translation:
        // [0,0] at [0,0] (width 5, height 5)
        // [1,1] at [10,10] (width 5, height 5) -> bottom right is at [15,15]
        // So grid bbox is [0, 0, 15, 15].
        // grid topLeft is [0, 0].
        // We align grid.topLeft to target.center [50, 50].
        // The translation should be dx=50, dy=50.
        
        expect(xy(scene, "grid_obj[0,0]").x).toBe(50);
        expect(xy(scene, "grid_obj[0,0]").y).toBe(50);
        
        expect(xy(scene, "grid_obj[1,1]").x).toBe(60);
        expect(xy(scene, "grid_obj[1,1]").y).toBe(60);
    });
});
