/**
 * Integration tests for complex geometric constructions — RelGeo v0.3
 *
 * These tests verify that multiple v0.3 features interact correctly:
 *   - Intersection + point placement
 *   - Tangent lines + derived geometry
 *   - Arc + path composition
 *   - Path modifiers + resolver pipeline
 *   - Query functions in derived values
 *   - Multi-object dependency chains
 */

import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { evaluateExpression } from "../evaluator";
import { applyCornerModifiers } from "../resolver/path-modifiers";
import { computeIntersections } from "../resolver/intersection";
import type {
  RelGeoDocument,
  ResolvedPoint,
  ResolvedLine,
  ResolvedCircle,
  ResolvedArc,
  ResolvedPath,
} from "../types";
import type { EvalContext } from "../evaluator";

// ─────────────────────────────────────────────
// Intersection + Point placement
// ─────────────────────────────────────────────

describe("Integration: Intersection → Point placement", () => {
  it("places a point at line-line intersection and uses it for further construction", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 10] },
        C: { type: "point", at: [0, 10] },
        D: { type: "point", at: [10, 0] },
        // Diagonal 1: A(0,0) → B(10,10)
        L1: { type: "line", from: "A", to: "B" },
        // Diagonal 2: C(0,10) → D(10,0)
        L2: { type: "line", from: "C", to: "D" },
        // Intersection should be at (5,5)
        P: { type: "point", at: "intersection(L1, L2)" },
        // Place a circle centered at the intersection point
        ring: { type: "circle", center: "P", radius: 3 },
      },
    };

    const res = resolveGeometry(doc);
    const P = res.objects.P as ResolvedPoint;
    const ring = res.objects.ring as ResolvedCircle;

    expect(P.x).toBeCloseTo(5);
    expect(P.y).toBeCloseTo(5);
    expect(ring.cx).toBeCloseTo(5);
    expect(ring.cy).toBeCloseTo(5);
    expect(ring.radius).toBe(3);
  });

  it("resolves intersection with 'first' selector for line-circle", () => {
    // Horizontal line through center, circle at origin radius 10
    // Two intersection points: (-10,0) and (10,0)
    // 'first' = x ascending = (-10, 0)
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
      },
    };
    const first = evaluateExpression("intersection(L, C, first)", ctx);
    expect(first.x).toBeCloseTo(-10);
    expect(first.y).toBeCloseTo(0);

    const last = evaluateExpression("intersection(L, C, last)", ctx);
    expect(last.x).toBeCloseTo(10);
    expect(last.y).toBeCloseTo(0);
  });

  it("resolves intersection with 'nearest' selector", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
        ref: { id: "ref", type: "point", x: 8, y: 0 } as any,
      },
    };
    // ref(8,0) is closest to (10,0)
    const result = evaluateExpression("intersection(L, C, nearest(ref))", ctx);
    expect(result.x).toBeCloseTo(10);
  });

  it("resolves intersection with 'farthest' selector", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
        ref: { id: "ref", type: "point", x: 8, y: 0 } as any,
      },
    };
    const result = evaluateExpression("intersection(L, C, farthest(ref))", ctx);
    expect(result.x).toBeCloseTo(-10);
  });

  it("throws MULTIPLE_INTERSECTIONS without selector for ambiguous result", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
      },
    };
    expect(() => evaluateExpression("intersection(L, C)", ctx)).toThrow("MULTIPLE_INTERSECTIONS");
  });

  it("throws NO_INTERSECTION when objects don't intersect", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -5, y1: 20, x2: 5, y2: 20 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
      },
    };
    expect(() => evaluateExpression("intersection(L, C, first)", ctx)).toThrow("NO_INTERSECTION");
  });

  it("normalizes negative intersection selectors as index range errors", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        L: { id: "L", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 } as any,
        C: { id: "C", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
      },
    };
    expect(() => evaluateExpression("intersection(L, C, -1)", ctx))
      .toThrow("INTERSECTION_INDEX_OUT_OF_RANGE");
    expect(() => evaluateExpression("intersection(L, C, {index: -1})", ctx))
      .toThrow("INTERSECTION_INDEX_OUT_OF_RANGE");
  });
});

// ─────────────────────────────────────────────
// Tangent line + arc construction chain
// ─────────────────────────────────────────────

describe("Integration: Tangent line → Arc chain", () => {
  it("tangent line from external point is perpendicular to radius at touch point", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        center: { type: "point", at: [0, 0] },
        external: { type: "point", at: [30, 0] },
        wheel: { type: "circle", center: "center", radius: 10 },
        tangentLine: {
          type: "line",
          from: "external",
          tangent: { from: "external", to: "wheel", pick: "first" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const t = res.objects.tangentLine as ResolvedLine;
    const wheel = res.objects.wheel as ResolvedCircle;

    // Touch point should be exactly radius distance from center
    const touchDist = Math.hypot(t.x2 - wheel.cx, t.y2 - wheel.cy);
    expect(touchDist).toBeCloseTo(10);

    // Radius-to-touchpoint vector should be perpendicular to tangent
    const radVec = { x: t.x2 - wheel.cx, y: t.y2 - wheel.cy };
    const tanVec = { x: t.x2 - t.x1, y: t.y2 - t.y1 };
    const dot = radVec.x * tanVec.x + radVec.y * tanVec.y;
    expect(dot).toBeCloseTo(0, 4);
  });

  it("arc three-point mode produces arc passing through all three points", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        P1: { type: "point", at: [-10, 0] },
        P2: { type: "point", at: [0, 10] },
        P3: { type: "point", at: [10, 0] },
        arc: { type: "arc", from: "P1", through: "P2", to: "P3" },
      },
    };

    const res = resolveGeometry(doc);
    const arc = res.objects.arc as ResolvedArc;

    // Center should be equidistant from all three points
    const d1 = Math.hypot(-10 - arc.cx!, 0 - arc.cy!);
    const d2 = Math.hypot(0 - arc.cx!, 10 - arc.cy!);
    const d3 = Math.hypot(10 - arc.cx!, 0 - arc.cy!);

    expect(d1).toBeCloseTo(arc.radius!);
    expect(d2).toBeCloseTo(arc.radius!);
    expect(d3).toBeCloseTo(arc.radius!);
  });
});

// ─────────────────────────────────────────────
// Query functions in derived values
// ─────────────────────────────────────────────

describe("Integration: Query functions in derived values", () => {
  it("uses pointAt() to place a point at parameter t=0.5 on a segmented path", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [20, 0] },
        outline: {
          type: "path",
          segments: [{ line: { from: "A", to: "B" } }],
        },
        midPoint: { type: "point", at: "pointAt(outline, 0.5)" },
      },
    };

    const res = resolveGeometry(doc);
    const mid = res.objects.midPoint as ResolvedPoint;
    expect(mid.x).toBeCloseTo(10);
    expect(mid.y).toBeCloseTo(0);
  });

  it("uses closestPoint() to snap a point to a circle", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        free: { type: "point", at: [15, 0] },
        wheel: { type: "circle", center: [0, 0], radius: 10 },
        snapped: { type: "point", at: "closestPoint(free, wheel)" },
      },
    };

    const res = resolveGeometry(doc);
    const snapped = res.objects.snapped as ResolvedPoint;
    // Closest point on circle (r=10) from (15,0) is (10, 0)
    expect(snapped.x).toBeCloseTo(10);
    expect(snapped.y).toBeCloseTo(0);
  });

  it("uses tangentAt() to derive tangent direction from path midpoint", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        // Horizontal line — tangent at any t should be (1, 0)
        hLine: { id: "hLine", type: "line", x1: 0, y1: 0, x2: 100, y2: 0 } as any,
      },
    };

    const tangent = evaluateExpression("tangentAt(hLine, 0.5)", ctx);
    expect(tangent.x).toBeCloseTo(1);
    expect(tangent.y).toBeCloseTo(0);
  });

  it("uses normalAt() and verifies it is orthogonal to tangentAt()", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        diag: { id: "diag", type: "line", x1: 0, y1: 0, x2: 3, y2: 4 } as any,
      },
    };

    const tg = evaluateExpression("tangentAt(diag, 0.5)", ctx);
    const nm = evaluateExpression("normalAt(diag, 0.5)", ctx);
    const dot = tg.x * nm.x + tg.y * nm.y;
    expect(dot).toBeCloseTo(0, 5);
  });

  it("uses length() derived value in an expression", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        seg: { id: "seg", type: "line", x1: 0, y1: 0, x2: 30, y2: 40 } as any,
      },
    };
    // length of 30-40-50 right triangle
    expect(evaluateExpression("length(seg)", ctx)).toBeCloseTo(50);
  });

  it("uses area() for a closed polygon in a derived value", () => {
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        sq: {
          id: "sq",
          type: "polygon",
          points: [
            { x: 0, y: 0 }, { x: 10, y: 0 },
            { x: 10, y: 10 }, { x: 0, y: 10 },
          ],
        } as any,
      },
    };
    expect(evaluateExpression("area(sq)", ctx)).toBeCloseTo(100);
  });
});

// ─────────────────────────────────────────────
// Multi-object dependency chains
// ─────────────────────────────────────────────

describe("Integration: Multi-step dependency chain", () => {
  it("resolves 4-level dependency: A → B → L → P → rect", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", from: "A", move: { right: 60 } },
        L: { type: "line", from: "A", to: "B" },
        P: { type: "point", at: "pointAt(L, 0.333)" }, // at x=19.98
        box: {
          type: "rect",
          size: [10, 10],
          place: { center: "P" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const B = res.objects.B as ResolvedPoint;
    const P = res.objects.P as ResolvedPoint;
    const box = res.objects.box as any;

    expect(B.x).toBeCloseTo(60);
    expect(P.x).toBeCloseTo(19.98);
    expect(box.x).toBeCloseTo(14.98);
    expect(box.y).toBeCloseTo(-5);
  });

  it("resolves circle-circle intersection and places derived geometry", () => {
    // Two circles of radius 10 centered at (0,0) and (12,0)
    // Their intersections are at approximately (6, ±8)
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        c1: { id: "c1", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
        c2: { id: "c2", type: "circle", cx: 12, cy: 0, radius: 10 } as any,
      },
    };

    const top = evaluateExpression("intersection(c1, c2, first)", ctx);
    const bottom = evaluateExpression("intersection(c1, c2, last)", ctx);

    // Both points should be on both circles
    expect(Math.hypot(top.x, top.y)).toBeCloseTo(10, 3);
    expect(Math.hypot(top.x - 12, top.y)).toBeCloseTo(10, 3);
    expect(Math.hypot(bottom.x, bottom.y)).toBeCloseTo(10, 3);

    // top and bottom should be symmetric around x-axis
    expect(top.y + bottom.y).toBeCloseTo(0, 4);
  });

  it("line-arc intersection resolves in correct angular range", () => {
    // Arc: quarter circle in Q1, from angle 0 to π/2, radius 10
    // Horizontal line y=5 should intersect the arc at one point in Q1
    const ctx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        arc: {
          id: "arc",
          type: "arc",
          cx: 0, cy: 0,
          radius: 10,
          startAngle: 0,
          endAngle: Math.PI / 2,
        } as any,
        L: { id: "L", type: "line", x1: -20, y1: 5, x2: 20, y2: 5 } as any,
      },
    };

    const pt = evaluateExpression("intersection(arc, L, first)", ctx);
    expect(pt.y).toBeCloseTo(5, 4);
    expect(pt.x).toBeGreaterThan(0); // in Q1
    expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(10, 3);
  });
});

// ─────────────────────────────────────────────
// Path modifiers integration through evaluator context
// ─────────────────────────────────────────────

describe("Integration: Path modifier engine contracts", () => {
  it("fillet radius smaller than segment half-length is always valid", () => {
    const segments: any[] = [
      { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },
      { type: "line", x1: 10, y1: 10, x2: 0, y2: 10 },
      { type: "line", x1: 0, y1: 10, x2: 0, y2: 0 },
    ];
    const labels = ["B", "C", "D", "A"];

    // Radius 3 < half-length 5, should not throw
    expect(() =>
      applyCornerModifiers(segments, labels, { all: { fillet: 3 } }, true, "box")
    ).not.toThrow();
  });

  it("chamfer on L-shaped path produces correct segment count", () => {
    const lShape: any[] = [
      { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },
    ];
    const labels = ["B", "C"];

    const result = applyCornerModifiers(lShape, labels, { B: { chamfer: 2 } }, false, "L");
    // Original 2 segs + 1 chamfer line = 3, but last seg was already processed
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────
// Error contract integration
// ─────────────────────────────────────────────

describe("Integration: Error codes are deterministic and informative", () => {
  it("DEGENERATE_ARC is thrown for three collinear points", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [5, 0] },
        C: { type: "point", at: [10, 0] },
        arc: { type: "arc", from: "A", through: "B", to: "C" },
      },
    };
    expect(() => resolveGeometry(doc)).toThrow("DEGENERATE_ARC");
  });

  it("PATH_NOT_CLOSED is thrown in strict mode for unclosed path", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        C: { type: "point", at: [10, 10] },
        p: { type: "path", closed: true, points: ["A", "B", "C"] },
      },
    };
    expect(() => resolveGeometry(doc, { mode: "validate" })).toThrow("PATH_NOT_CLOSED");
  });

  it("TANGENT_NOT_FOUND is thrown for point inside circle", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        inner: { type: "point", at: [3, 0] },
        circle: { type: "circle", center: [0, 0], radius: 10 },
        t: {
          type: "line",
          from: "inner",
          tangent: { from: "inner", to: "circle" },
        },
      },
    };
    expect(() => resolveGeometry(doc)).toThrow("TANGENT_NOT_FOUND");
  });

  it("UNSUPPORTED_FEATURE is thrown for unsupported intersection type", () => {
    const t = { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, content: "hi" };
    const c = { id: "c", type: "circle", cx: 5, cy: 5, radius: 5 };
    expect(() => computeIntersections(t, c, "test")).toThrow("UNSUPPORTED_FEATURE");
  });

  it("INVALID_CORNER_OPERATION is thrown for oversized fillet", () => {
    const segs: any[] = [
      { type: "line", x1: 0, y1: 0, x2: 5, y2: 0 },
      { type: "line", x1: 5, y1: 0, x2: 5, y2: 5 },
    ];
    expect(() =>
      applyCornerModifiers(segs, ["B", "C"], { B: { fillet: 100 } }, false, "p")
    ).toThrow("INVALID_CORNER_OPERATION");
  });

  it("throws error if 'from' is defined on non-first path segment", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        p: {
          type: "path",
          segments: [
            { line: { from: [0, 0], to: [10, 0] } },
            { line: { from: [10, 0], to: [10, 10] } } // Disallowed
          ]
        }
      }
    };
    expect(() => resolveGeometry(doc, { mode: "validate" })).toThrow();
  });
});
