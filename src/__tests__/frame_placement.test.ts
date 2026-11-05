import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { Validator } from "../validator";
import type { RelGeoDocument } from "../types";

const mockTextMetrics = {
  measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
  measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("v0.4: Frame & Oriented Placement (Phase D)", () => {
  it("resolves basic frameAt query with correct point, tangent, normal, and angle on a line", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        notch: {
          type: "rect",
          size: [10, 4],
          anchors: {
            pt: ["frameAt(L, 0.25).point.x", "frameAt(L, 0.25).point.y"],
            ang: ["frameAt(L, 0.25).angle", 0],
            tan: ["frameAt(L, 0.25).tangent.x", "frameAt(L, 0.25).tangent.y"],
            norm: ["frameAt(L, 0.25).normal.x", "frameAt(L, 0.25).normal.y"]
          }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const resolvedNotch = scene.objects["notch"] as any;

    expect(resolvedNotch).toBeDefined();
    
    // Check that custom anchors resolved accurately
    expect(resolvedNotch.anchors.pt).toEqual({ x: 25, y: 0 });
    expect(resolvedNotch.anchors.ang).toEqual({ x: 0, y: 0 });
    expect(resolvedNotch.anchors.tan).toEqual({ x: 1, y: 0 });
    expect(resolvedNotch.anchors.norm).toEqual({ x: 0, y: 1 });
  });

  it("fails validation if both place and on are defined on the same placeable shape", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        box: {
          type: "rect",
          size: [10, 10],
          place: { left: 0 },
          on: { frame: { path: "L", t: 0.5 } }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).toThrow(/Cannot use both "place" and "on" constraints/);
  });

  it("fails resolution if t is outside [0, 1] during evaluation", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        box: {
          type: "rect",
          size: [10, 10],
          on: { frame: { path: "L", t: 1.5 } }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow(); // Valid syntax-wise

    expect(() => resolveGeometry(doc, { textMetrics: mockTextMetrics })).toThrow(/FRAME_RESOLUTION_FAILED/);
  });

  it("fails resolution if frameAt receives a non-finite t", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      parameters: {
        t: { type: "number", default: Number.POSITIVE_INFINITY }
      },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        box: {
          type: "rect",
          size: [10, 10],
          on: { frame: { path: "L", t: "t" } }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();
    expect(() => resolveGeometry(doc, { textMetrics: mockTextMetrics })).toThrow(/FRAME_RESOLUTION_FAILED/);
  });

  it("correctly applies oriented placement to place a rectangle on an angled line", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 100] // 45-degree angle
        } as any,
        notch: {
          type: "rect",
          size: [10, 4],
          on: { frame: { path: "L", t: 0.5 } }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const resolvedNotch = scene.objects["notch"] as any;

    expect(resolvedNotch).toBeDefined();
    
    // Angled line at t=0.5 goes through [50, 50]
    // The center of notch bounding box (which has size [10, 4] and center [5, 2])
    // should be translated to [50, 50]
    // So dx = 50 - 5 = 45, dy = 50 - 2 = 48
    expect(resolvedNotch.x).toBe(45);
    expect(resolvedNotch.y).toBe(48);

    // It should have prepended a rotate transform centered at [50, 50] with 45 degrees
    expect(resolvedNotch.transform).toBeDefined();
    expect(resolvedNotch.transform.length).toBe(1);
    expect(resolvedNotch.transform[0].type).toBe("rotate");
    expect(resolvedNotch.transform[0].angle).toBeCloseTo(45);
    expect(resolvedNotch.transform[0].origin).toEqual({ x: 50, y: 50 });
  });

  it("correctly applies oriented placement using on: { point: ... } without rotation", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        P: {
          type: "point",
          at: [50, 60]
        } as any,
        notch: {
          type: "rect",
          size: [10, 4],
          on: { point: { at: "P" } }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const resolvedNotch = scene.objects["notch"] as any;

    expect(resolvedNotch).toBeDefined();
    // Center at [5, 2] should align with [50, 60]
    // So dx = 50 - 5 = 45, dy = 60 - 2 = 58
    expect(resolvedNotch.x).toBe(45);
    expect(resolvedNotch.y).toBe(58);
    expect(resolvedNotch.transform).toBeUndefined();
  });

  it("correctly resolves tAtLength query on a line", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        L: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        notch: {
          type: "rect",
          size: [10, 4],
          anchors: {
            // L is 100px long. 25px length should correspond to t = 0.25
            pt: ["tAtLength(L, 25) * 100", 0]
          }
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const resolvedNotch = scene.objects["notch"] as any;

    expect(resolvedNotch).toBeDefined();
    expect(resolvedNotch.anchors.pt.x).toBeCloseTo(25);
  });
});
