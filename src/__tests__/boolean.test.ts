import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { resolveBoolean } from "../resolver/primitives/shapes";
import { evaluateExpression } from "../evaluator";
import { createEvalContext } from "../resolver/eval-context";
import { defaultTextMetricsProvider, type RelGeoDocument, type ResolvedBoolean, type ResolvedCollection } from "../types";

const mockTextMetrics = {
  measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
  measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("v0.4: Robust 2D Closed-Shape Boolean Operations", () => {
  it("resolves a union of two intersecting rectangles and derives area/center", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        r1: { type: "rect", size: [10, 10], place: { left: 0, top: 0 } },
        r2: { type: "rect", size: [10, 10], place: { left: 5, top: 0 } },
        merged: {
          type: "boolean",
          operation: "union",
          shapes: ["r1", "r2"],
        },
      },
    };

    const res = resolveGeometry(doc);
    const merged = res.objects.merged as ResolvedBoolean;

    expect(merged.type).toBe("boolean");
    expect(merged.operation).toBe("union");

    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics
    });

    // Area of r1 (100) + r2 (100) - intersection (5 * 10 = 50) = 150
    expect(evaluateExpression("merged.area", evalCtx)).toBeCloseTo(150);
    // Center should be (7.5, 5) since bounding box runs from x=0 to 15, y=0 to 10
    expect(evaluateExpression("merged.centerX", evalCtx)).toBeCloseTo(7.5);
    expect(evaluateExpression("merged.centerY", evalCtx)).toBeCloseTo(5);
    expect(evaluateExpression("perimeter(merged)", evalCtx)).toBeCloseTo(50);
    expect(evaluateExpression("bbox(merged)", evalCtx)).toEqual({
      minX: 0,
      maxX: 15,
      minY: 0,
      maxY: 10,
      width: 15,
      height: 10,
    });
  });

  it("resolves a subtraction of slot from panel", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        panel: { type: "rect", size: [100, 100] },
        slot: { type: "rect", size: [20, 20], place: { centerX: 50, centerY: 50 } },
        cutPanel: {
          type: "boolean",
          operation: "subtract",
          base: "panel",
          tools: ["slot"],
        },
      },
    };

    const res = resolveGeometry(doc);
    const cutPanel = res.objects.cutPanel as ResolvedBoolean;

    expect(cutPanel.type).toBe("boolean");
    expect(cutPanel.operation).toBe("subtract");

    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics
    });

    // Subtracting slot (20 * 20 = 400) from panel (100 * 100 = 10000) = 9600
    expect(evaluateExpression("cutPanel.area", evalCtx)).toBeCloseTo(9600);
    expect(evaluateExpression("perimeter(cutPanel)", evalCtx)).toBeCloseTo(480);
  });

  it("resolves xor as deterministic multipart topology and exposes measurements", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        left: { type: "rect", size: [10, 10], place: { left: 0, top: 0 } },
        right: { type: "rect", size: [10, 10], place: { left: 5, top: 0 } },
        symmetricDifference: {
          type: "boolean",
          operation: "xor",
          shapes: ["left", "right"],
          result: { mode: "multi" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics,
    });

    expect((res.objects.symmetricDifference as ResolvedBoolean).points?.length ?? 0).toBeGreaterThan(4);
    expect(evaluateExpression("area(symmetricDifference)", evalCtx)).toBeCloseTo(100);
    expect(evaluateExpression("bbox(symmetricDifference)", evalCtx)).toEqual({
      minX: 0,
      maxX: 15,
      minY: 0,
      maxY: 10,
      width: 15,
      height: 10,
    });
  });

  it("preserves nested semantic holes and supports holes[index] anchor access", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        panel: { type: "rect", size: [100, 100] },
        hole1: { type: "circle", center: [20, 20], radius: 5 },
        hole2: { type: "circle", center: [80, 80], radius: 5 },
        // Create base shape with holes
        panelWithHoles: {
          type: "boolean",
          operation: "subtract",
          base: "panel",
          tools: ["hole1", "hole2"],
        },
        // Anchor checks using evaluateExpression to simulate DSL accesses
        h1Area: { type: "point", at: ["panelWithHoles.holes[0].area", 0] },
        h1Center: { type: "point", at: "panelWithHoles.holes[0].center" },
        h2Center: { type: "point", at: "panelWithHoles.holes[1].center" },
      },
    };

    const res = resolveGeometry(doc);
    const panelWithHoles = res.objects.panelWithHoles as ResolvedBoolean;
    const h1Area = res.objects.h1Area as any;
    const h1Center = res.objects.h1Center as any;
    const h2Center = res.objects.h2Center as any;

    expect(panelWithHoles.holes).toHaveLength(2);
    // Area of circle radius 5 is PI * 25 ~ 78.54. Since Clipper discretizes circles, assert with 0 decimal places.
    expect(h1Area.x).toBeCloseTo(Math.PI * 25, 0);
    // Verify centers of individual holes are correctly resolved and retrievable
    // Note: Clipper output order might vary, so we can assert they match either center
    const centers = [{ x: h1Center.x, y: h1Center.y }, { x: h2Center.x, y: h2Center.y }];
    expect(centers).toContainEqual({ x: 20, y: 20 });
    expect(centers).toContainEqual({ x: 80, y: 80 });
  });

  it("throws BOOLEAN_MULTIPART_RESULT if operation produces multiple islands in single mode", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        panel: { type: "rect", size: [100, 100] },
        // Large horizontal cutter that splits panel in two pieces
        cutter: { type: "rect", size: [120, 20], place: { centerX: 50, centerY: 50 } },
        cutResult: {
          type: "boolean",
          operation: "subtract",
          base: "panel",
          tools: ["cutter"],
          result: { mode: "single" },
        },
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("BOOLEAN_MULTIPART_RESULT");
  });

  it("rejects invalid Boolean result modes before topology resolution", () => {
    const doc = {
      version: 0.5,
      objects: {
        left: { type: "rect", size: [10, 10] },
        invalid: {
          type: "boolean",
          operation: "union",
          shapes: ["left"],
          result: { mode: "many" },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc)).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      path: "objects.invalid.result.mode",
    }));
  });

  it("rejects open and non-shape Boolean operands at validation paths", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        edge: { type: "line", from: [0, 0], to: [10, 0] },
        merged: { type: "boolean", operation: "union", shapes: ["edge"] },
      },
    } as any;

    expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      path: "objects.merged.shapes[0]",
    }));
  });

  it("fails cyclic clone operands deterministically instead of recursing", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        first: { type: "clone", of: "second" },
        second: { type: "clone", of: "first" },
        merged: { type: "boolean", operation: "union", shapes: ["first"] },
      },
    } as any;

    expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      path: "objects.merged.shapes[0]",
    }));
  });

  it("preserves geometry closed-shape codes for editor-mode direct resolution", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        edge: { type: "line", from: [0, 0], to: [10, 0] },
        merged: { type: "boolean", operation: "union", shapes: ["edge"] },
      },
    } as any;

    expect(() => resolveBoolean("merged", doc.objects!.merged as any, {
      scalars: {},
      objects: doc.objects as any,
      targetUnit: "px",
      mode: "validate",
      textMetrics: defaultTextMetricsProvider,
    })).toThrowError(expect.objectContaining({
      code: "INVALID_CLOSED_SHAPE",
      path: "objects.merged",
      objectId: "merged",
    }));
  });

  it("successfully resolves multipart shape in multi mode", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        panel: { type: "rect", size: [100, 100] },
        cutter: { type: "rect", size: [120, 20], place: { centerX: 50, centerY: 50 } },
        cutResult: {
          type: "boolean",
          operation: "subtract",
          base: "panel",
          tools: ["cutter"],
          result: { mode: "multi" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const cutResult = res.objects.cutResult as ResolvedBoolean;
    expect(cutResult.type).toBe("boolean");

    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics
    });

    // Outer area of two 100x40 rectangles is 8000
    expect(evaluateExpression("cutResult.area", evalCtx)).toBeCloseTo(8000);
  });

  it("uses the v0.5 collection contract for ordered boolean multi results", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        left: { type: "rect", size: [10, 10], place: { left: 0, top: 0 } },
        right: { type: "rect", size: [10, 10], place: { left: 5, top: 0 } },
        symmetricDifference: {
          type: "boolean",
          operation: "xor",
          shapes: ["left", "right"],
          result: { mode: "multi" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const collection = res.objects.symmetricDifference as ResolvedCollection;
    expect(collection.type).toBe("collection");
    expect(collection.children).toEqual(["symmetricDifference[0]", "symmetricDifference[1]"]);
    expect(res.objects[collection.children[0]]?.type).toBe("boolean");
    expect(res.objects[collection.children[1]]?.type).toBe("boolean");

    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics,
    });
    expect(evaluateExpression("count(symmetricDifference)", evalCtx)).toBe(2);
    expect(evaluateExpression("area(first(symmetricDifference))", evalCtx)).toBeCloseTo(50);
    expect(evaluateExpression("area(last(symmetricDifference))", evalCtx)).toBeCloseTo(50);
  });

  it("resolves first-class primitive shapes and references inside holes array of a path", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      objects: {
        lcdCutout: { type: "rect", size: [80, 40], place: { left: 40, top: 30 } },
        plate: {
          type: "path",
          segments: [
            { line: { from: [0, 0], to: [160, 0] } },
            { line: { to: [160, 100] } },
            { line: { to: [0, 100] } },
            { line: { to: [0, 0] } }
          ],
          closed: true,
          holes: [
            // Reference to top-level shape
            "lcdCutout",
            // Direct nested closed shape
            { type: "circle", center: [20, 50], radius: 10 }
          ]
        }
      }
    };

    const res = resolveGeometry(doc);
    const plate = res.objects.plate as any;

    expect(plate.type).toBe("path");
    expect(plate.holes).toHaveLength(2);
    
    const evalCtx = createEvalContext({
      scalars: {},
      objects: res.objects,
      targetUnit: "px",
      textMetrics: mockTextMetrics
    });

    const expectedArea = 16000 - 3200 - Math.PI * 100;
    expect(evaluateExpression("plate.area", evalCtx)).toBeCloseTo(expectedArea, -1);
  });
});
