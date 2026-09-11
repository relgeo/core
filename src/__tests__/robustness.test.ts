import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";
import { evaluateExpression, EvalContext } from "../evaluator";

describe("Engine Robustness - New Features", () => {
  describe("Strict Validation (CONSTRAINTS)", () => {
    it("should pass if rect has no 'place' (v0.2 default position)", () => {
      const yaml = `
version: 0.2
objects:
  box:
    type: rect
    size: [100, 100]
`;
      expect(() => parseRelGeo(yaml, { strict: true })).not.toThrow();
    });

    it("should pass if rect has full constraints via 'place'", () => {
      const yaml = `
version: 0.1
objects:
  box:
    type: rect
    size: [100, 100]
    place: { left: 0, top: 0 }
`;
      expect(() => parseRelGeo(yaml, { strict: true })).not.toThrow();
    });

    it("should throw error if rect is over-constrained horizontally", () => {
      const yaml = `
version: 0.1
objects:
  box:
    type: rect
    size: [100, 100]
    place: { left: 0, right: 100, centerX: 50, top: 0 }
`;
      expect(() => parseRelGeo(yaml, { strict: true })).toThrow("over-constrained horizontally");
    });

    it("should throw error if rect is over-constrained vertically", () => {
      const yaml = `
version: 0.1
objects:
  box:
    type: rect
    size: [100, 100]
    place: { left: 0, top: 0, bottom: 100, centerY: 50 }
`;
      expect(() => parseRelGeo(yaml, { strict: true })).toThrow("over-constrained vertically");
    });
  });

  describe("Dynamic Identifier & Anchor Resolution", () => {
    it("should resolve complex nested anchors (dot notation) via hook", () => {
      const ctx: EvalContext = {
        scalars: {},
        targetUnit: "px",
        resolveIdentifier: (name) => {
          if (name === "A.left") return 10;
          if (name === "A.right") return 110;
          if (name === "A.center.x") return 60;
          if (name === "A.topLeft.y") return 20;
          return undefined;
        }
      };

      // Test direct anchor
      expect(evaluateExpression("A.left", ctx)).toBe(10);
      expect(evaluateExpression("A.right", ctx)).toBe(110);
      
      // Test nested anchor (point component)
      expect(evaluateExpression("A.center.x", ctx)).toBe(60);
      expect(evaluateExpression("A.topLeft.y", ctx)).toBe(20);
    });

    it("should resolve identifiers via resolveIdentifier hook", () => {
      const ctx: EvalContext = {
        scalars: { base: 10 },
        targetUnit: "px",
        resolveIdentifier: (name) => {
          if (name === "dynamic") return 42;
          return undefined;
        }
      };

      expect(evaluateExpression("base + dynamic", ctx)).toBe(52);
    });
  });

  describe("Namespace Separation", () => {
    it("should prioritize scalars over objects if names collide", () => {
      const ctx: EvalContext = {
        scalars: { collision: 100 },
        targetUnit: "px"
      };
      
      expect(evaluateExpression("collision", ctx)).toBe(100);
    });
  });
});
