import { describe, it, expect } from "vitest";
import {
  computeFillet,
  computeChamfer,
  applyCornerModifiers,
  offsetPolyline,
  validateNoSelfIntersection,
  type PathSegment,
} from "../resolver/path-modifiers";

// ─────────────────────────────────────────────
// computeFillet()
// ─────────────────────────────────────────────

describe("computeFillet()", () => {
  // 90° right-angle corner at origin: coming from left, going up
  const cornerPoint = { x: 0, y: 0 };
  const prevDir = { x: 1, y: 0 }; // INTO corner from left
  const nextDir = { x: 0, y: 1 }; // OUT of corner upward

  it("produces a fillet arc for a 90° corner", () => {
    const f = computeFillet(cornerPoint, prevDir, nextDir, 5, "B");
    // setback = r / tan(45°) = 5
    expect(f.p1.x).toBeCloseTo(-5); // setback from corner along incoming (reversed)
    expect(f.p1.y).toBeCloseTo(0);
    expect(f.p2.x).toBeCloseTo(0);
    expect(f.p2.y).toBeCloseTo(5);
    expect(Math.hypot(f.p1.x - f.center.x, f.p1.y - f.center.y)).toBeCloseTo(5);
    expect(Math.hypot(f.p2.x - f.center.x, f.p2.y - f.center.y)).toBeCloseTo(5);
  });

  it("fillet center is equidistant from both tangent points (radius)", () => {
    const f = computeFillet(cornerPoint, prevDir, nextDir, 10, "C");
    const d1 = Math.hypot(f.p1.x - f.center.x, f.p1.y - f.center.y);
    const d2 = Math.hypot(f.p2.x - f.center.x, f.p2.y - f.center.y);
    expect(d1).toBeCloseTo(10);
    expect(d2).toBeCloseTo(10);
  });

  it("throws INVALID_CORNER_OPERATION for zero radius", () => {
    expect(() => computeFillet(cornerPoint, prevDir, nextDir, 0, "B")).toThrow("INVALID_CORNER_OPERATION");
  });

  it("throws INVALID_CORNER_OPERATION for negative radius", () => {
    expect(() => computeFillet(cornerPoint, prevDir, nextDir, -3, "B")).toThrow("INVALID_CORNER_OPERATION");
  });
});

// ─────────────────────────────────────────────
// computeChamfer()
// ─────────────────────────────────────────────

describe("computeChamfer()", () => {
  const corner = { x: 10, y: 0 };
  const prevDir = { x: 1, y: 0 }; // INTO corner
  const nextDir = { x: 0, y: 1 }; // OUT

  it("produces correct chamfer cut points for 90° corner", () => {
    const c = computeChamfer(corner, prevDir, nextDir, 3, "C");
    expect(c.p1.x).toBeCloseTo(7);  // corner.x - 3 along prevDir reversed
    expect(c.p1.y).toBeCloseTo(0);
    expect(c.p2.x).toBeCloseTo(10);
    expect(c.p2.y).toBeCloseTo(3);  // corner + 3 along nextDir
  });

  it("throws INVALID_CORNER_OPERATION for zero distance", () => {
    expect(() => computeChamfer(corner, prevDir, nextDir, 0, "C")).toThrow("INVALID_CORNER_OPERATION");
  });
});

// ─────────────────────────────────────────────
// applyCornerModifiers()
// ─────────────────────────────────────────────

describe("applyCornerModifiers() — fillet", () => {
  // Box: A(0,0) → B(10,0) → C(10,10) → D(0,10) → A
  const boxSegs: PathSegment[] = [
    { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },   // A→B
    { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },  // B→C
    { type: "line", x1: 10, y1: 10, x2: 0, y2: 10 },  // C→D
    { type: "line", x1: 0, y1: 10, x2: 0, y2: 0 },    // D→A
  ];
  const labels = ["B", "C", "D", "A"];

  it("fillet at B only: inserts one arc, total segments = 5", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { B: { fillet: 2 } },
      true,
      "box"
    );
    expect(result).toHaveLength(5); // 4 lines + 1 arc replacing corner B
    const arcSegs = result.filter(s => s.type === "arc");
    expect(arcSegs).toHaveLength(1);
  });

  it("fillet all corners: inserts 4 arcs, total segments = 8", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { all: { fillet: 1 } },
      true,
      "box"
    );
    const arcSegs = result.filter(s => s.type === "arc");
    expect(arcSegs).toHaveLength(4);
    expect(result.length).toBeGreaterThanOrEqual(8);
  });

  it("fillet arc center is at radius distance from tangent points", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { B: { fillet: 2 } },
      true,
      "box"
    );
    const arcSeg = result.find(s => s.type === "arc") as any;
    expect(arcSeg).toBeDefined();
    const d1 = Math.hypot(arcSeg.x1 - arcSeg.cx, arcSeg.y1 - arcSeg.cy);
    const d2 = Math.hypot(arcSeg.x2 - arcSeg.cx, arcSeg.y2 - arcSeg.cy);
    expect(d1).toBeCloseTo(2, 4);
    expect(d2).toBeCloseTo(2, 4);
  });

  it("closing corner fillet uses the small arc, not a wrapped large arc", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { A: { fillet: 2 } },
      true,
      "box"
    );
    const arcSeg = result.find((s) => s.type === "arc") as any;
    expect(arcSeg).toBeDefined();
    expect(arcSeg.largeArc).toBe(0);
  });

  it("throws INVALID_CORNER_OPERATION when fillet radius exceeds segment length", () => {
    expect(() => applyCornerModifiers(
      boxSegs,
      labels,
      { B: { fillet: 100 } }, // way too large
      true,
      "box"
    )).toThrow("INVALID_CORNER_OPERATION");
  });
});

describe("applyCornerModifiers() — chamfer", () => {
  const boxSegs: PathSegment[] = [
    { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
    { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },
    { type: "line", x1: 10, y1: 10, x2: 0, y2: 10 },
    { type: "line", x1: 0, y1: 10, x2: 0, y2: 0 },
  ];
  const labels = ["B", "C", "D", "A"];

  it("chamfer at C: inserts one extra line, total = 5", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { C: { chamfer: 2 } },
      true,
      "box"
    );
    expect(result).toHaveLength(5);
    // All segments should be lines
    expect(result.every(s => s.type === "line")).toBe(true);
  });

  it("chamfer all corners: 4 extra lines = 8 total", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { all: { chamfer: 1 } },
      true,
      "box"
    );
    expect(result).toHaveLength(8);
  });

  it("chamfer cut points are at correct distance from corner", () => {
    const result = applyCornerModifiers(
      boxSegs,
      labels,
      { B: { chamfer: 2 } },
      true,
      "box"
    );
    // The first segment should end at x=8, y=0 (corner at 10,0, setback 2 along x)
    const firstSeg = result[0] as any;
    expect(firstSeg.x2).toBeCloseTo(8);
    expect(firstSeg.y2).toBeCloseTo(0);
  });

  it("throws INVALID_CORNER_OPERATION when chamfer exceeds segment length", () => {
    expect(() => applyCornerModifiers(
      boxSegs,
      labels,
      { B: { chamfer: 50 } },
      true,
      "box"
    )).toThrow("INVALID_CORNER_OPERATION");
  });
});

// ─────────────────────────────────────────────
// offsetPolyline()
// ─────────────────────────────────────────────

describe("offsetPolyline()", () => {
  // Horizontal segment: (0,0)→(10,0)
  const hLine = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it("left offset shifts segment upward (CCW side)", () => {
    const result = offsetPolyline(hLine, 5, "left", false, "p");
    expect(result[0].y).toBeCloseTo(5);
    expect(result[1].y).toBeCloseTo(5);
  });

  it("right offset shifts segment downward (CW side)", () => {
    const result = offsetPolyline(hLine, 5, "right", false, "p");
    expect(result[0].y).toBeCloseTo(-5);
    expect(result[1].y).toBeCloseTo(-5);
  });

  it("preserves x extent for horizontal line", () => {
    const result = offsetPolyline(hLine, 3, "left", false, "p");
    expect(result[0].x).toBeCloseTo(0);
    expect(result[1].x).toBeCloseTo(10);
  });

  it("L-shape offset produces correct corner junction", () => {
    // L-shape: (0,0)→(10,0)→(10,10) with left offset distance 2
    const lShape = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const result = offsetPolyline(lShape, 2, "left", false, "p");
    expect(result).toHaveLength(3);
    // Middle point should be the miter join at the corner
    expect(result[1].x).toBeCloseTo(8); // corner moved inside by 2
    expect(result[1].y).toBeCloseTo(2);
  });

  it("zero offset returns same points", () => {
    const result = offsetPolyline(hLine, 0, "left", false, "p");
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 10, y: 0 });
  });

  it("throws INVALID_OFFSET for single point path", () => {
    expect(() => offsetPolyline([{ x: 0, y: 0 }], 5, "left", false, "p")).toThrow("INVALID_OFFSET");
  });

  it("inside/outside: outside span is greater than inside span", () => {
    // Use a simple square in screen-style coordinates:
    // positive area here corresponds to a visually clockwise outline.
    const square = [
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 }
    ];
    const inside = offsetPolyline(square, 2, "inside", true, "sq");
    const outside = offsetPolyline(square, 2, "outside", true, "sq");

    const insideSpan = Math.max(...inside.map(p => p.x)) - Math.min(...inside.map(p => p.x));
    const outsideSpan = Math.max(...outside.map(p => p.x)) - Math.min(...outside.map(p => p.x));

    expect(outsideSpan).toBeGreaterThan(10);
    expect(insideSpan).toBeLessThan(10);
  });
});

// ─────────────────────────────────────────────
// validateNoSelfIntersection()
// ─────────────────────────────────────────────

describe("validateNoSelfIntersection()", () => {
  it("square (no self-intersection) passes", () => {
    const square = [
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(() => validateNoSelfIntersection(square, true, "sq")).not.toThrow();
  });

  it("figure-8 (self-intersecting) throws SELF_INTERSECTING_PATH", () => {
    // Figure-8: segments cross in the middle
    const fig8 = [
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    expect(() => validateNoSelfIntersection(fig8, false, "fig8")).toThrow("SELF_INTERSECTING_PATH");
  });

  it("bowtie shape (closed self-intersecting) throws SELF_INTERSECTING_PATH", () => {
    const bowtie = [
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    expect(() => validateNoSelfIntersection(bowtie, true, "bowtie")).toThrow("SELF_INTERSECTING_PATH");
  });

  it("open non-intersecting path passes", () => {
    const path = [
      { x: 0, y: 0 }, { x: 5, y: 3 },
      { x: 10, y: 0 }, { x: 15, y: 3 },
    ];
    expect(() => validateNoSelfIntersection(path, false, "path")).not.toThrow();
  });
});
