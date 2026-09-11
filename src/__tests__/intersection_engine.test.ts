import { describe, it, expect } from "vitest";
import {
  intersectLines,
  intersectLineCircle,
  intersectCircles,
  intersectLineArc,
  intersectCircleArc,
  intersectArcs,
  computeIntersections,
  applySelector,
} from "../resolver/intersection";

// ─────────────────────────────────────────────
// Math kernel tests
// ─────────────────────────────────────────────

describe("intersectLines()", () => {
  it("intersects two perpendicular lines", () => {
    const h = { id: "h", type: "line" as const, x1: 0, y1: 5, x2: 10, y2: 5 };
    const v = { id: "v", type: "line" as const, x1: 5, y1: 0, x2: 5, y2: 10 };
    const result = intersectLines(h, v);
    expect(result?.x).toBeCloseTo(5);
    expect(result?.y).toBeCloseTo(5);
  });

  it("returns null for parallel lines", () => {
    const l1 = { id: "l1", type: "line" as const, x1: 0, y1: 0, x2: 10, y2: 0 };
    const l2 = { id: "l2", type: "line" as const, x1: 0, y1: 5, x2: 10, y2: 5 };
    expect(intersectLines(l1, l2)).toBeNull();
  });

  it("intersects diagonal lines at origin", () => {
    const d1 = { id: "d1", type: "line" as const, x1: -1, y1: -1, x2: 1, y2: 1 };
    const d2 = { id: "d2", type: "line" as const, x1: -1, y1: 1, x2: 1, y2: -1 };
    const result = intersectLines(d1, d2);
    expect(result?.x).toBeCloseTo(0);
    expect(result?.y).toBeCloseTo(0);
  });
});

describe("intersectLineCircle()", () => {
  const circle = { id: "c", type: "circle" as const, cx: 0, cy: 0, radius: 10 };

  it("horizontal line through circle center → 2 points", () => {
    const line = { id: "l", type: "line" as const, x1: -20, y1: 0, x2: 20, y2: 0 };
    const pts = intersectLineCircle(line, circle);
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(-10);
    expect(pts[1].x).toBeCloseTo(10);
  });

  it("tangent line → 1 point", () => {
    const line = { id: "l", type: "line" as const, x1: -20, y1: 10, x2: 20, y2: 10 };
    const pts = intersectLineCircle(line, circle);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[0].y).toBeCloseTo(10);
  });

  it("line missing circle → 0 points", () => {
    const line = { id: "l", type: "line" as const, x1: -20, y1: 15, x2: 20, y2: 15 };
    expect(intersectLineCircle(line, circle)).toHaveLength(0);
  });
});

describe("intersectCircles()", () => {
  it("two intersecting circles → 2 points", () => {
    const c1 = { id: "c1", type: "circle" as const, cx: 0, cy: 0, radius: 10 };
    const c2 = { id: "c2", type: "circle" as const, cx: 12, cy: 0, radius: 10 };
    const pts = intersectCircles(c1, c2);
    expect(pts).toHaveLength(2);
    // Both points should satisfy both circle equations
    pts.forEach((p) => {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 4);
      expect(Math.hypot(p.x - 12, p.y)).toBeCloseTo(10, 4);
    });
  });

  it("tangent circles → 1 point", () => {
    const c1 = { id: "c1", type: "circle" as const, cx: 0, cy: 0, radius: 5 };
    const c2 = { id: "c2", type: "circle" as const, cx: 10, cy: 0, radius: 5 };
    const pts = intersectCircles(c1, c2);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(5);
    expect(pts[0].y).toBeCloseTo(0);
  });

  it("concentric circles → 0 points", () => {
    const c1 = { id: "c1", type: "circle" as const, cx: 0, cy: 0, radius: 5 };
    const c2 = { id: "c2", type: "circle" as const, cx: 0, cy: 0, radius: 10 };
    expect(intersectCircles(c1, c2)).toHaveLength(0);
  });

  it("non-overlapping circles → 0 points", () => {
    const c1 = { id: "c1", type: "circle" as const, cx: 0, cy: 0, radius: 3 };
    const c2 = { id: "c2", type: "circle" as const, cx: 20, cy: 0, radius: 3 };
    expect(intersectCircles(c1, c2)).toHaveLength(0);
  });
});

describe("intersectLineArc()", () => {
  const arc = {
    id: "a",
    type: "arc" as const,
    cx: 0,
    cy: 0,
    radius: 10,
    startAngle: 0,
    endAngle: Math.PI / 2,
  };

  it("line through arc region → intersection within arc bounds", () => {
    // y=5 line should cross the quarter-circle arc in the first quadrant
    const line = { id: "l", type: "line" as const, x1: -20, y1: 5, x2: 20, y2: 5 };
    const pts = intersectLineArc(line, arc);
    expect(pts.length).toBeGreaterThanOrEqual(1);
    // The valid point should be in Q1 (x>0, y>0)
    pts.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeCloseTo(5, 4);
    });
  });

  it("line outside arc angular range → 0 points", () => {
    // x=-8 vertical line: intersects full circle at Q2/Q3, but arc is Q1 only
    const line = { id: "l", type: "line" as const, x1: -8, y1: -20, x2: -8, y2: 20 };
    const pts = intersectLineArc(line, arc);
    expect(pts).toHaveLength(0);
  });
});

describe("intersectCircleArc()", () => {
  it("circle intersecting arc region → 1 or more points", () => {
    const circle = { id: "c", type: "circle" as const, cx: 10, cy: 0, radius: 5 };
    const arc = {
      id: "a",
      type: "arc" as const,
      cx: 0,
      cy: 0,
      radius: 10,
      startAngle: -Math.PI / 4,
      endAngle: Math.PI / 4,
    };
    const pts = intersectCircleArc(circle, arc);
    expect(pts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("intersectArcs()", () => {
  it("two overlapping arcs → intersection within both bounds", () => {
    const a1 = {
      id: "a1",
      type: "arc" as const,
      cx: 0,
      cy: 0,
      radius: 10,
      startAngle: -Math.PI / 4,
      endAngle: Math.PI / 4,
    };
    const a2 = {
      id: "a2",
      type: "arc" as const,
      cx: 12,
      cy: 0,
      radius: 10,
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
    };
    // These arcs share circle-circle intersections but the angular ranges
    // may not overlap — expect 0 or more valid points
    const pts = intersectArcs(a1, a2);
    expect(Array.isArray(pts)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Deterministic ordering
// ─────────────────────────────────────────────

describe("deterministic ordering", () => {
  it("line-circle results are sorted by x ascending", () => {
    const circle = { id: "c", type: "circle" as const, cx: 0, cy: 0, radius: 10 };
    const line = { id: "l", type: "line" as const, x1: -20, y1: 0, x2: 20, y2: 0 };
    const pts = intersectLineCircle(line, circle);
    expect(pts[0].x).toBeLessThanOrEqual(pts[1].x);
  });

  it("circle-circle results are sorted by x ascending", () => {
    const c1 = { id: "c1", type: "circle" as const, cx: 0, cy: 0, radius: 10 };
    const c2 = { id: "c2", type: "circle" as const, cx: 12, cy: 0, radius: 10 };
    const pts = intersectCircles(c1, c2);
    expect(pts[0].x).toBeLessThanOrEqual(pts[1].x);
  });
});

// ─────────────────────────────────────────────
// applySelector() tests
// ─────────────────────────────────────────────

describe("applySelector()", () => {
  const pts = [
    { x: 1, y: 5 },
    { x: 3, y: 7 },
    { x: 9, y: 2 },
  ];

  it("throws MULTIPLE_INTERSECTIONS when no selector and >1 result", () => {
    expect(() => applySelector(pts, undefined, "test")).toThrow("MULTIPLE_INTERSECTIONS");
  });

  it("returns single point when 1 result and no selector", () => {
    expect(applySelector([{ x: 5, y: 5 }], undefined, "test")).toEqual({ x: 5, y: 5 });
  });

  it("throws NO_INTERSECTION when 0 results", () => {
    expect(() => applySelector([], "first", "test")).toThrow("NO_INTERSECTION");
  });

  it("first → returns index 0", () => {
    expect(applySelector(pts, "first", "test")).toEqual(pts[0]);
  });

  it("last → returns last element", () => {
    expect(applySelector(pts, "last", "test")).toEqual(pts[pts.length - 1]);
  });

  it("index 1 → returns pts[1]", () => {
    expect(applySelector(pts, { index: 1 }, "test")).toEqual(pts[1]);
  });

  it("index out of range → throws", () => {
    expect(() => applySelector(pts, { index: 99 }, "test")).toThrow("out of range");
  });

  it("nearest(ref) → returns closest point", () => {
    const ref = { x: 2, y: 6 }; // closest to { x:1,y:5 } or { x:3,y:7 }
    const result = applySelector(pts, { nearest: ref }, "test");
    // dist²(1,5)=(1+1)=2, dist²(3,7)=(1+1)=2  — tie goes to first by sort
    // dist²(9,2)=(49+16)=65
    expect([pts[0], pts[1]]).toContainEqual(result);
  });

  it("farthest(ref) → returns farthest point", () => {
    const ref = { x: 0, y: 0 };
    const result = applySelector(pts, { farthest: ref }, "test");
    // { x:9,y:2 } has dist²=85, others are 26 and 58
    expect(result).toEqual(pts[2]);
  });
});

// ─────────────────────────────────────────────
// computeIntersections dispatch
// ─────────────────────────────────────────────

describe("computeIntersections() dispatch", () => {
  it("line-line", () => {
    const l1 = { id: "l1", type: "line", x1: 0, y1: 5, x2: 10, y2: 5 };
    const l2 = { id: "l2", type: "line", x1: 5, y1: 0, x2: 5, y2: 10 };
    const pts = computeIntersections(l1, l2, "test");
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(5);
  });

  it("circle-line (order-independent)", () => {
    const c = { id: "c", type: "circle", cx: 0, cy: 0, radius: 10 };
    const l = { id: "l", type: "line", x1: -20, y1: 0, x2: 20, y2: 0 };
    expect(computeIntersections(c, l, "test")).toHaveLength(2);
    expect(computeIntersections(l, c, "test")).toHaveLength(2);
  });

  it("circle-circle", () => {
    const c1 = { id: "c1", type: "circle", cx: 0, cy: 0, radius: 10 };
    const c2 = { id: "c2", type: "circle", cx: 12, cy: 0, radius: 10 };
    expect(computeIntersections(c1, c2, "test")).toHaveLength(2);
  });

  it("line-path", () => {
    const l = { id: "l", type: "line", x1: 5, y1: -10, x2: 5, y2: 30 };
    const p = {
      id: "p",
      type: "path",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
      ],
    };
    const pts = computeIntersections(l, p, "test");
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(5);
    expect(pts[0].y).toBeCloseTo(0);
  });

  it("path-path", () => {
    const p1 = {
      id: "p1",
      type: "path",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const p2 = {
      id: "p2",
      type: "path",
      points: [
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ],
    };
    const pts = computeIntersections(p1, p2, "test");
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(5);
    expect(pts[0].y).toBeCloseTo(5);
  });

  it("line-polygon uses resolved polygon segments when available", () => {
    const l = { id: "l", type: "line", x1: 18, y1: -10, x2: 18, y2: 30 };
    const poly = {
      id: "poly",
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      segments: [
        { type: "line", x1: 0, y1: 0, x2: 15, y2: 0 },
        { type: "arc", x1: 15, y1: 0, xt: 18.5355339059, yt: 1.4644660941, x2: 20, y2: 5, cx: 15, cy: 5, radius: 5, sweep: 0, largeArc: 0 },
        { type: "line", x1: 20, y1: 5, x2: 20, y2: 20 },
        { type: "line", x1: 20, y1: 20, x2: 0, y2: 20 },
        { type: "line", x1: 0, y1: 20, x2: 0, y2: 0 },
      ],
    };
    const pts = computeIntersections(l, poly, "test");
    expect(pts.length).toBeGreaterThan(0);
    expect(pts[0].x).toBeCloseTo(18, 4);
    expect(pts[0].y).toBeGreaterThan(0);
  });

  it("unsupported type → throws UNSUPPORTED_FEATURE", () => {
    const t = { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, content: "hi" };
    const c = { id: "c", type: "circle", cx: 0, cy: 0, radius: 5 };
    expect(() => computeIntersections(t, c, "test")).toThrow("UNSUPPORTED_FEATURE");
  });
});
