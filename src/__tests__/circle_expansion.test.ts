import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument, ResolvedCircle } from "../types";

describe("circle resolution expansion", () => {
  it("should resolve circle with through property", () => {
    const doc: RelGeoDocument = {
      version: 0.2,
      objects: {
        C1: { type: "point", at: [10, 10] },
        T1: { type: "point", at: [40, 50] }, // Distance is sqrt(30^2 + 40^2) = 50
        L1: {
          type: "circle",
          center: "C1",
          through: "T1"
        }
      }
    };

    const res = resolveGeometry(doc);
    const L1 = res.objects.L1 as ResolvedCircle;
    expect(L1.cx).toBe(10);
    expect(L1.cy).toBe(10);
    expect(L1.radius).toBeCloseTo(50);
  });

  it("should resolve circle with radius and center", () => {
     const doc: RelGeoDocument = {
      version: 0.2,
      objects: {
        L1: {
          type: "circle",
          center: [100, 100],
          radius: 50
        }
      }
    };

    const res = resolveGeometry(doc);
    const L1 = res.objects.L1 as ResolvedCircle;
    expect(L1.cx).toBe(100);
    expect(L1.cy).toBe(100);
    expect(L1.radius).toBe(50);
  });
});
