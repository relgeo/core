import { describe, it, expect } from "vitest";
import { convertToPx, convertFromPx, normalizeUnit } from "../units";

describe("units", () => {
  describe("convertToPx", () => {
    it("should handle numbers", () => {
      expect(convertToPx(100)).toBe(100);
    });

    it("should handle px strings", () => {
      expect(convertToPx("100px")).toBe(100);
    });

    it("should handle cm strings", () => {
      // 1cm = 96 / 2.54 px
      expect(convertToPx("1cm")).toBeCloseTo(37.79527, 4);
    });

    it("should handle mm strings", () => {
      // 1mm = 96 / 25.4 px
      expect(convertToPx("1mm")).toBeCloseTo(3.77952, 4);
    });

    it("should handle m strings", () => {
      // 1m = 100cm
      expect(convertToPx("1m")).toBeCloseTo(3779.527, 2);
    });

    it("should handle invalid units by parsing number", () => {
      expect(convertToPx("100xyz")).toBe(100);
    });

    it("should reject malformed known-unit values instead of truncating them", () => {
      expect(() => convertToPx("1.2.3cm")).toThrow("INVALID_UNIT_VALUE");
      expect(() => convertToPx("NaNpx")).toThrow("INVALID_UNIT_VALUE");
      expect(() => convertToPx(Number.NaN)).toThrow("INVALID_UNIT_VALUE");
    });
  });

  describe("convertFromPx", () => {
    it("should convert back to cm", () => {
      const px = convertToPx("1cm");
      expect(convertFromPx(px, "cm")).toBe(1);
    });

    it("should convert back to m", () => {
      const px = convertToPx("5m");
      expect(convertFromPx(px, "m")).toBe(5);
    });
  });

  describe("normalizeUnit", () => {
    it("should normalize m to cm", () => {
      expect(normalizeUnit("1m", "cm")).toBe(100);
    });

    it("should normalize cm to mm", () => {
      expect(normalizeUnit("1cm", "mm")).toBeCloseTo(10);
    });

    it("should default to px", () => {
      expect(normalizeUnit("1cm")).toBeCloseTo(37.79527, 4);
    });
  it("should treat unitless numbers as target unit", () => {
    expect(normalizeUnit(72, "cm")).toBe(72);
    expect(normalizeUnit("72", "cm")).toBe(72);
    expect(normalizeUnit(100, "mm")).toBe(100);
  });
  it("should preserve non-unit string literals", () => {
    expect(normalizeUnit("not-a-number")).toBe("not-a-number");
    expect(normalizeUnit("guide")).toBe("guide");
  });
  it("should reject malformed numeric values with known units", () => {
    expect(() => normalizeUnit("1.2.3cm")).toThrow("INVALID_UNIT_VALUE");
    expect(() => normalizeUnit("1e2cm", "mm")).not.toThrow();
    expect(normalizeUnit("1e2cm", "mm")).toBeCloseTo(1000);
  });
});
});
