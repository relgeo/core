import { describe, it, expect } from "vitest";
import { normalizeUnit } from "../units";
import { evaluateExpression } from "../evaluator";

describe("RelGeo Unit System (Standardization)", () => {
  describe("normalizeUnit - Smart Units Logic", () => {
    it("should treat unitless numbers as targetUnit (scene.unit)", () => {
      // If scene is in cm, 72 means 72cm
      expect(normalizeUnit(72, "cm")).toBe(72);
      expect(normalizeUnit("72", "cm")).toBe(72);
    });

    it("should convert explicit units to targetUnit", () => {
      // 1m in a cm scene should be 100cm
      expect(normalizeUnit("1m", "cm")).toBeCloseTo(100, 5);
      // 10mm in a cm scene should be 1cm
      expect(normalizeUnit("10mm", "cm")).toBeCloseTo(1, 5);
      // 1in in a cm scene should be 2.54cm
      expect(normalizeUnit("1in", "cm")).toBeCloseTo(2.54, 5);
    });

    it("should handle px conversion accurately", () => {
      // 1cm to px (standard 96 DPI)
      expect(normalizeUnit("1cm", "px")).toBeCloseTo(37.795, 2);
    });
  });

  describe("Expression Evaluation - Scalar vs Length", () => {
    const ctx = {
      scalars: { x: 20 }, // x is 20 in targetUnit (e.g. cm)
      targetUnit: "cm" as const,
    };

    it("should treat unitless numbers as scalars in multiplication", () => {
      // 10 * 20cm = 200cm
      expect(evaluateExpression("10 * x", ctx)).toBe(200);
    });

    it("should treat unitless numbers as scalars in division", () => {
      // 20cm / 2 = 10cm
      expect(evaluateExpression("x / 2", ctx)).toBe(10);
    });

    it("should treat unitless numbers as targetUnit in addition", () => {
      // 10 (defaults to cm) + 20cm = 30cm
      expect(evaluateExpression("10 + x", ctx)).toBe(30);
    });

    it("should handle mixed explicit units in expressions", () => {
      // 1m (100cm) + 20cm = 120cm
      expect(evaluateExpression("1m + x", ctx)).toBe(120);
      // 10 * 1m (100cm) = 1000cm
      expect(evaluateExpression("10 * 1m", ctx)).toBe(1000);
    });
  });
});
