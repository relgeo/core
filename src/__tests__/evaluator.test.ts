import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  EvalContext,
  validateExpressionSyntax,
} from "../evaluator";

describe("evaluator", () => {
  const ctx: EvalContext = {
    scalars: {
      lingkarDada: 92,
      ease: 6,
    },
    targetUnit: "cm",
  };

  it("should evaluate basic numbers", () => {
    expect(evaluateExpression("10", ctx)).toBe(10);
  });

  it("should evaluate unit literals", () => {
    // 1m in cm is 100
    expect(evaluateExpression("1m", ctx)).toBe(100);
  });

  it("should evaluate identifiers", () => {
    expect(evaluateExpression("lingkarDada", ctx)).toBe(92);
  });

  it("should evaluate basic arithmetic", () => {
    expect(evaluateExpression("10 + 20", ctx)).toBe(30);
    expect(evaluateExpression("50 - 20", ctx)).toBe(30);
    expect(evaluateExpression("10 * 3", ctx)).toBe(30);
    expect(evaluateExpression("60 / 2", ctx)).toBe(30);
  });

  it("should respect precedence", () => {
    expect(evaluateExpression("10 + 5 * 2", ctx)).toBe(20);
    expect(evaluateExpression("(10 + 5) * 2", ctx)).toBe(30);
  });

  it("should handle expressions with units and identifiers", () => {
    // 92 / 4 + 6 / 4 = 23 + 1.5 = 24.5
    expect(evaluateExpression("lingkarDada / 4 + ease / 4", ctx)).toBe(24.5);
  });

  it("should handle mixed units", () => {
    // 1m (100cm) + 10cm = 110cm
    expect(evaluateExpression("1m + 10cm", ctx)).toBe(110);
  });

  it("should throw on unknown identifier", () => {
    expect(() => evaluateExpression("unknownVar", ctx)).toThrow("Unknown identifier: unknownVar");
  });

  it("should throw on division by zero", () => {
    expect(() => evaluateExpression("10 / 0", ctx)).toThrow("Division by zero");
  });

  it("should syntax-check geometry query divisors without a geometry context", () => {
    expect(() => validateExpressionSyntax("x / distance(A, B)")).not.toThrow();
  });

  it("should reject trailing tokens in malformed expressions", () => {
    expect(() => evaluateExpression("10 foo", ctx)).toThrowError(expect.objectContaining({
      code: "INVALID_EXPRESSION",
      phase: "resolve",
    }));
    expect(() => validateExpressionSyntax("10 foo")).toThrowError(expect.objectContaining({
      code: "INVALID_EXPRESSION",
      phase: "validate",
    }));
  });

  it("should reject invalid operators", () => {
    expect(() => evaluateExpression("10cm ** 2", ctx)).toThrow("Invalid token: *");
  });

  it("enforces the v0.5 narrow numeric coercion contract", () => {
    expect(evaluateExpression("10cm + 5mm", ctx)).toBeCloseTo(10.5, 8);
    expect(evaluateExpression("2 * 10cm", ctx)).toBeCloseTo(20, 8);
    expect(evaluateExpression("10cm / 2", ctx)).toBeCloseTo(5, 8);
    expect(evaluateExpression("10cm + 2", ctx)).toBeCloseTo(12, 8);
    expect(() => evaluateExpression("10cm + \"x\"", ctx)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      phase: "resolve",
    }));
    expect(() => evaluateExpression("10cm * 5cm", ctx)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      phase: "resolve",
    }));
    expect(() => evaluateExpression("2 / 10cm", ctx)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      phase: "resolve",
    }));
  });

  it("should handle rounding functions", () => {
    expect(evaluateExpression("round(10.5)", ctx)).toBe(11);
    expect(evaluateExpression("floor(10.9)", ctx)).toBe(10);
    expect(evaluateExpression("ceil(10.1)", ctx)).toBe(11);
  });
  
  it("should handle trigonometry and math functions", () => {
    // Note: Math functions in JS take radians.
    // 0 radians
    expect(evaluateExpression("sin(0)", ctx)).toBe(0);
    expect(evaluateExpression("cos(0)", ctx)).toBe(1);
    expect(evaluateExpression("tan(0)", ctx)).toBe(0);
    expect(evaluateExpression("sqrt(16)", ctx)).toBe(4);
  });

  it("should calculate generalized length() for arc and path", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        arc1: {
          id: "arc1",
          type: "arc",
          radius: 20,
          startAngle: 0,
          endAngle: Math.PI / 2,
        } as any,
        path1: {
          id: "path1",
          type: "path",
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 4 },
            { x: 6, y: 8 },
          ],
        } as any,
        closedPath1: {
          id: "closedPath1",
          type: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
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

    expect(evaluateExpression("length(arc1)", geoCtx)).toBeCloseTo(10 * Math.PI);
    expect(evaluateExpression("length(path1)", geoCtx)).toBe(10);
    expect(evaluateExpression("length(closedPath1)", geoCtx)).toBe(40);
    expect(evaluateExpression("length(poly1)", geoCtx)).toBe(40);
  });

  it("should calculate area() for rect, circle, polygon, and closed path", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        r1: { id: "r1", type: "rect", x: 0, y: 0, width: 40, height: 20 } as any,
        c1: { id: "c1", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
        poly1: {
          id: "poly1",
          type: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
          ],
        } as any,
        path1: {
          id: "path1",
          type: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
            { x: 0, y: 0 },
          ],
        } as any,
      },
    };

    expect(evaluateExpression("area(r1)", geoCtx)).toBe(800);
    expect(evaluateExpression("area(c1)", geoCtx)).toBeCloseTo(100 * Math.PI);
    expect(evaluateExpression("area(poly1)", geoCtx)).toBe(800);
    expect(evaluateExpression("area(path1)", geoCtx)).toBe(800);
  });

  it("should include closed-shape holes in area() and perimeter() queries", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        panel: {
          id: "panel",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          holes: [{
            segments: [
              { type: "line", x1: 40, y1: 40, x2: 60, y2: 40 },
              { type: "line", x1: 60, y1: 40, x2: 60, y2: 60 },
              { type: "line", x1: 60, y1: 60, x2: 40, y2: 60 },
              { type: "line", x1: 40, y1: 60, x2: 40, y2: 40 },
            ],
          }],
        } as any,
      },
    };

    expect(evaluateExpression("area(panel)", geoCtx)).toBe(9600);
    expect(evaluateExpression("perimeter(panel)", geoCtx)).toBe(480);
  });

  it("should reject area() on open path", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        path1: {
          id: "path1",
          type: "path",
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
          ],
        } as any,
      },
    };

    expect(() => evaluateExpression("area(path1)", geoCtx)).toThrow("must be closed");
  });

  it("should calculate pointAt() for line, arc, and path", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        l1: { id: "l1", type: "line", x1: 0, y1: 0, x2: 20, y2: 0 } as any,
        a1: {
          id: "a1",
          type: "arc",
          cx: 0,
          cy: 0,
          radius: 10,
          startAngle: 0,
          endAngle: Math.PI / 2,
        } as any,
        p1: {
          id: "p1",
          type: "path",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        } as any,
        closedPath1: {
          id: "closedPath1",
          type: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
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

    expect(evaluateExpression("pointAt(l1, 0.5)", geoCtx)).toEqual({ x: 10, y: 0 });
    const arcMid = evaluateExpression("pointAt(a1, 0.5)", geoCtx);
    expect(arcMid.x).toBeCloseTo(Math.sqrt(50));
    expect(arcMid.y).toBeCloseTo(Math.sqrt(50));
    expect(evaluateExpression("pointAt(p1, 0.75)", geoCtx)).toEqual({ x: 10, y: 5 });
    expect(evaluateExpression("pointAt(closedPath1, 0.875)", geoCtx)).toEqual({ x: 0, y: 5 });
    expect(evaluateExpression("pointAt(poly1, 0.875)", geoCtx)).toEqual({ x: 0, y: 5 });
  });

  it("should calculate closestPoint() for line, circle, and polygon", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        ref1: { id: "ref1", type: "point", x: 5, y: 7 } as any,
        ref2: { id: "ref2", type: "point", x: 20, y: 0 } as any,
        ref3: { id: "ref3", type: "point", x: 50, y: 10 } as any,
        l1: { id: "l1", type: "line", x1: 0, y1: 0, x2: 10, y2: 0 } as any,
        c1: { id: "c1", type: "circle", cx: 0, cy: 0, radius: 10 } as any,
        poly1: {
          id: "poly1",
          type: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
          ],
        } as any,
        closedPath1: {
          id: "closedPath1",
          type: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
          ],
        } as any,
        ref4: { id: "ref4", type: "point", x: -5, y: 10 } as any,
      },
    };

    expect(evaluateExpression("closestPoint(ref1, l1)", geoCtx)).toEqual({ x: 5, y: 0 });
    expect(evaluateExpression("closestPoint(ref2, c1)", geoCtx)).toEqual({ x: 10, y: 0 });
    expect(evaluateExpression("closestPoint(ref3, poly1)", geoCtx)).toEqual({ x: 40, y: 10 });
    expect(evaluateExpression("closestPoint(ref4, closedPath1)", geoCtx)).toEqual({ x: 0, y: 10 });
  });

  it("should calculate area() from curved path segments instead of control polygon", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        arcCap: {
          id: "arcCap",
          type: "path",
          closed: true,
          points: [
            { x: -10, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 0 },
            { x: -10, y: 0 },
          ],
          segments: [
            { type: "arc", x1: -10, y1: 0, xt: 0, yt: 10, x2: 10, y2: 0, cx: 0, cy: 0, radius: 10, sweep: 0, largeArc: 0 },
            { type: "line", x1: 10, y1: 0, x2: -10, y2: 0 },
          ],
        } as any,
      },
    };

    expect(evaluateExpression("area(arcCap)", geoCtx)).toBeCloseTo(50 * Math.PI, 0);
  });

  it("should calculate closestPoint() on modified polygon segments, not original sharp edges", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        ref: { id: "ref", type: "point", x: 18, y: 2 } as any,
        rounded: {
          id: "rounded",
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
        } as any,
      },
    };

    const point = evaluateExpression("closestPoint(ref, rounded)", geoCtx);
    expect(point.x).toBeGreaterThan(15);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(5);
  });

  it("should convert point coordinates with toWorld() and toLocal()", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      parentMap: new Map([["box", "group1"]]),
      objects: {
        localPt: { id: "localPt", type: "point", x: 10, y: 5 } as any,
        worldPt: { id: "worldPt", type: "point", x: 110, y: 55 } as any,
        box: {
          id: "box",
          type: "rect",
          x: 0,
          y: 0,
          width: 20,
          height: 10,
          transform: [{ type: "translate", x: 100, y: 50 }],
        } as any,
        group1: {
          id: "group1",
          type: "group",
          children: ["box"],
          transform: [{ type: "translate", x: 0, y: 0 }],
        } as any,
      },
    };

    expect(evaluateExpression("toWorld(localPt, box)", geoCtx)).toEqual({ x: 110, y: 55 });
    expect(evaluateExpression("toLocal(worldPt, box)", geoCtx)).toEqual({ x: 10, y: 5 });
  });

  it("should evaluate logical and relational operators", () => {
    expect(evaluateExpression("10 > 5", ctx)).toBe(true);
    expect(evaluateExpression("10 < 5", ctx)).toBe(false);
    expect(evaluateExpression("10 >= 10", ctx)).toBe(true);
    expect(evaluateExpression("10 <= 9", ctx)).toBe(false);
    expect(evaluateExpression("10 == 10", ctx)).toBe(true);
    expect(evaluateExpression("10 != 5", ctx)).toBe(true);
    
    expect(evaluateExpression("(10 > 5) && (5 < 10)", ctx)).toBe(true);
    expect(evaluateExpression("(10 < 5) || (5 < 10)", ctx)).toBe(true);
    expect(evaluateExpression("!(10 < 5)", ctx)).toBe(true);
  });

  it("should evaluate ternary operator", () => {
    expect(evaluateExpression("10 > 5 ? 100 : 200", ctx)).toBe(100);
    expect(evaluateExpression("10 < 5 ? 100 : 200", ctx)).toBe(200);
    expect(evaluateExpression("lingkarDada > 90 ? 10 : 5", ctx)).toBe(10);
  });

  it("should evaluate modulo operator", () => {
    expect(evaluateExpression("10 % 3", ctx)).toBe(1);
    expect(evaluateExpression("15 % 5", ctx)).toBe(0);
  });

  it("should evaluate exponentiation operator", () => {
    expect(evaluateExpression("2 ^ 3", ctx)).toBe(8);
    expect(evaluateExpression("2 ^ 3 ^ 2", ctx)).toBe(512); // Right-associative: 2^(3^2) = 2^9 = 512
    expect(evaluateExpression("10 * 2 ^ 3", ctx)).toBe(80); // Exponentiation has higher precedence than multiplication
  });

  it("should evaluate text functions", () => {
    const textCtx: EvalContext = {
      scalars: {
        prefix: "A",
        count: 5
      },
      targetUnit: "px",
      objects: {
        box1: { id: "box1", type: "rect", x: 0, y: 0, width: 10, height: 10 } as any
      }
    };

    expect(evaluateExpression('concat("Part-", prefix, "-", count)', textCtx)).toBe("Part-A-5");
    expect(evaluateExpression('charAt("Hello", 1)', textCtx)).toBe("e");
    expect(evaluateExpression('charAt("Hello", 0)', textCtx)).toBe("H");
    expect(evaluateExpression('format("ID: {0} (Width: {1})", prefix, box1.width)', textCtx)).toBe("ID: A (Width: 10)");
  });

  it("should evaluate v0.5 utility point and bbox functions", () => {
    const geoCtx: EvalContext = {
      scalars: {
        localPt: { x: 2, y: 3 },
      },
      targetUnit: "px",
      resolveIdentifier: (name: string) => {
        if (name === "localPt") return { x: 2, y: 3 };
        return undefined;
      },
      objects: {
        A: { id: "A", type: "point", x: 0, y: 0 } as any,
        B: { id: "B", type: "point", x: 10, y: 10 } as any,
        centerPt: { id: "centerPt", type: "point", x: 5, y: 5 } as any,
        mirrorCenter: { id: "mirrorCenter", type: "point", x: 4, y: 1 } as any,
        guideLine: { id: "guideLine", type: "line", x1: 0, y1: 0, x2: 10, y2: 0 } as any,
        rect1: { id: "rect1", type: "rect", x: 10, y: 20, width: 30, height: 40 } as any,
        ellipse1: { id: "ellipse1", type: "ellipse", cx: 20, cy: 30, rx: 10, ry: 5, rotation: 0 } as any,
      },
    };

    expect(evaluateExpression("midpoint(A, B)", geoCtx)).toEqual({ x: 5, y: 5 });
    expect(evaluateExpression("polar(centerPt, 10, 0)", geoCtx)).toEqual({ x: 15, y: 5 });
    expect(evaluateExpression("angleBetween(A, B)", geoCtx)).toBeCloseTo(Math.PI / 4);
    expect(evaluateExpression("bbox(rect1)", geoCtx)).toEqual({
      minX: 10,
      maxX: 40,
      minY: 20,
      maxY: 60,
      width: 30,
      height: 40,
    });
    expect(evaluateExpression("bbox(rect1).width", geoCtx)).toBe(30);
    expect(evaluateExpression("bbox(rect1).minX", geoCtx)).toBe(10);
    expect(evaluateExpression("width(rect1)", geoCtx)).toBe(30);
    expect(evaluateExpression("height(rect1)", geoCtx)).toBe(40);
    expect(evaluateExpression("minX(rect1)", geoCtx)).toBe(10);
    expect(evaluateExpression("maxX(rect1)", geoCtx)).toBe(40);
    expect(evaluateExpression("minY(rect1)", geoCtx)).toBe(20);
    expect(evaluateExpression("maxY(rect1)", geoCtx)).toBe(60);
    expect(evaluateExpression("project(localPt, guideLine)", geoCtx)).toEqual({ x: 2, y: 0 });
    expect(evaluateExpression("reflect(localPt, mirrorCenter)", geoCtx)).toEqual({ x: 6, y: -1 });
    expect(evaluateExpression("reflect(localPt, guideLine)", geoCtx)).toEqual({ x: 2, y: -3 });
    expect(evaluateExpression("perimeter(ellipse1)", geoCtx)).toBeCloseTo(
      Math.PI * (10 + 5) * (1 + (3 * ((10 - 5) ** 2 / (10 + 5) ** 2)) / (10 + Math.sqrt(4 - 3 * ((10 - 5) ** 2 / (10 + 5) ** 2))))
    );
  });

  it("should evaluate perimeter() for closed shapes and reject open paths", () => {
    const geoCtx: EvalContext = {
      scalars: {},
      targetUnit: "px",
      objects: {
        closedPath: {
          id: "closedPath",
          type: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        } as any,
        openPath: {
          id: "openPath",
          type: "path",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        } as any,
      },
    };

    expect(evaluateExpression("perimeter(closedPath)", geoCtx)).toBe(40);
    expect(() => evaluateExpression("perimeter(openPath)", geoCtx)).toThrow("must be closed");
  });
});
