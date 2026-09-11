import { describe, it, expect } from "vitest";
import { evaluateExpression, EvalContext } from "../evaluator";

const geoCtx: EvalContext = {
  scalars: {},
  targetUnit: "px",
  objects: {
    // Horizontal line from (0,0) to (10,0)
    hLine: { id: "hLine", type: "line", x1: 0, y1: 0, x2: 10, y2: 0 } as any,
    // Vertical line from (0,0) to (0,10)
    vLine: { id: "vLine", type: "line", x1: 0, y1: 0, x2: 0, y2: 10 } as any,
    // Diagonal line (3-4-5 right triangle direction)
    dLine: { id: "dLine", type: "line", x1: 0, y1: 0, x2: 3, y2: 4 } as any,
    // Arc: quarter circle CCW from 0 to π/2
    arc1: {
      id: "arc1",
      type: "arc",
      cx: 0,
      cy: 0,
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    } as any,
    // Arc: clockwise from π/2 to 0
    arcCW: {
      id: "arcCW",
      type: "arc",
      cx: 0,
      cy: 0,
      radius: 10,
      startAngle: Math.PI / 2,
      endAngle: 0,
    } as any,
    // Quadratic bezier: from (0,0) cp (5,10) to (10,0)
    quad1: {
      id: "quad1",
      type: "quadratic",
      x1: 0,
      y1: 0,
      cpx: 5,
      cpy: 10,
      x2: 10,
      y2: 0,
    } as any,
    // Cubic bezier: symmetric arch
    cubic1: {
      id: "cubic1",
      type: "cubic",
      x1: 0,
      y1: 0,
      cp1x: 0,
      cp1y: 10,
      cp2x: 10,
      cp2y: 10,
      x2: 10,
      y2: 0,
    } as any,
    poly1: {
      id: "poly1",
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    } as any,
  },
};

describe("tangentAt()", () => {
  it("horizontal line → tangent is (1,0)", () => {
    const t = evaluateExpression("tangentAt(hLine, 0.5)", geoCtx);
    expect(t.x).toBeCloseTo(1);
    expect(t.y).toBeCloseTo(0);
  });

  it("vertical line → tangent is (0,1)", () => {
    const t = evaluateExpression("tangentAt(vLine, 0.5)", geoCtx);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1);
  });

  it("diagonal line → tangent is unit vector (0.6,0.8)", () => {
    const t = evaluateExpression("tangentAt(dLine, 0.5)", geoCtx);
    expect(t.x).toBeCloseTo(0.6);
    expect(t.y).toBeCloseTo(0.8);
  });

  it("arc at t=0 → tangent is (0,1) (CCW quarter circle starts at angle 0)", () => {
    // At angle=0: tangent = (-sin(0), cos(0)) = (0, 1)
    const t = evaluateExpression("tangentAt(arc1, 0)", geoCtx);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1);
  });

  it("arc at t=1 → tangent is (-1,0) (CCW quarter circle ends at angle π/2)", () => {
    // At angle=π/2: tangent = (-sin(π/2), cos(π/2)) = (-1, 0)
    const t = evaluateExpression("tangentAt(arc1, 1)", geoCtx);
    expect(t.x).toBeCloseTo(-1);
    expect(t.y).toBeCloseTo(0);
  });

  it("tangent result is a unit vector (length ≈ 1)", () => {
    const t = evaluateExpression("tangentAt(quad1, 0.5)", geoCtx);
    const len = Math.hypot(t.x, t.y);
    expect(len).toBeCloseTo(1);
  });

  it("cubic bezier tangent at t=0.5 is a unit vector", () => {
    const t = evaluateExpression("tangentAt(cubic1, 0.5)", geoCtx);
    const len = Math.hypot(t.x, t.y);
    expect(len).toBeCloseTo(1);
  });

  it("quadratic at t=0.5 on symmetric arch → tangent x=1, y≈0", () => {
    // Symmetric arch: apex at (5,10). At t=0.5, tangent should point right (+x direction)
    const t = evaluateExpression("tangentAt(quad1, 0.5)", geoCtx);
    expect(t.x).toBeGreaterThan(0.99);
    expect(Math.abs(t.y)).toBeLessThan(0.02);
  });

  it("throws on unknown object", () => {
    expect(() => evaluateExpression("tangentAt(missing, 0.5)", geoCtx)).toThrow("Unknown or invalid object in tangentAt: missing");
  });

  it("polygon supports tangentAt() with closed-path semantics", () => {
    const t = evaluateExpression("tangentAt(poly1, 0.875)", geoCtx);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(-1);
  });
});

describe("normalAt()", () => {
  it("horizontal line → normal is (0,1) or (0,-1)", () => {
    // Normal is tangent rotated 90° CCW. Tangent=(1,0) → normal=(0,1)
    const n = evaluateExpression("normalAt(hLine, 0.5)", geoCtx);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
  });

  it("vertical line → normal is (-1,0)", () => {
    // Tangent=(0,1) → normal=(-1,0) (CCW rotation)
    const n = evaluateExpression("normalAt(vLine, 0.5)", geoCtx);
    expect(n.x).toBeCloseTo(-1);
    expect(n.y).toBeCloseTo(0);
  });

  it("normal is perpendicular to tangent (dot product ≈ 0)", () => {
    const tg = evaluateExpression("tangentAt(quad1, 0.3)", geoCtx);
    const nm = evaluateExpression("normalAt(quad1, 0.3)", geoCtx);
    const dot = tg.x * nm.x + tg.y * nm.y;
    expect(dot).toBeCloseTo(0, 5);
  });

  it("normal result is a unit vector", () => {
    const n = evaluateExpression("normalAt(arc1, 0.5)", geoCtx);
    const len = Math.hypot(n.x, n.y);
    expect(len).toBeCloseTo(1);
  });

  it("throws on unknown object", () => {
    expect(() => evaluateExpression("normalAt(missing, 0.5)", geoCtx)).toThrow("Unknown or invalid object in normalAt: missing");
  });

  it("polygon supports normalAt() with closed-path semantics", () => {
    const n = evaluateExpression("normalAt(poly1, 0.875)", geoCtx);
    expect(n.x).toBeCloseTo(1);
    expect(n.y).toBeCloseTo(0);
  });
});
