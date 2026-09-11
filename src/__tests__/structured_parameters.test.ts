import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { evaluateExpression } from "../evaluator";
import { createEvalContext } from "../resolver/eval-context";
import { resolveValues } from "../resolver/values";
import type { RelGeoDocument } from "../types";

const mockTextMetrics = {
  measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
  measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("v0.4: Structured Parameters & Constants (Phase A)", () => {
  it("resolves parameters and constants with recursive unit normalization", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: {
        unit: "px"
      },
      parameters: {
        posisiAwal: {
          type: "point" as any,
          default: ["10mm", "20mm"]
        },
        boltPattern: {
          type: "object" as any,
          default: {
            diameter: "6mm",
            spacing: "20mm"
          }
        }
      },
      constants: {
        gridSpacing: ["15mm", "25mm"]
      },
      objects: {}
    };

    const scalars = resolveValues(doc);

    // Verify posisiAwal points are normalized from mm to px
    expect(scalars.posisiAwal).toBeInstanceOf(Array);
    expect(scalars.posisiAwal[0]).toBeCloseTo(10 * (96 / 25.4));
    expect(scalars.posisiAwal[1]).toBeCloseTo(20 * (96 / 25.4));

    // Verify boltPattern object properties are normalized
    expect(scalars.boltPattern).toBeTypeOf("object");
    expect(scalars.boltPattern.diameter).toBeCloseTo(6 * (96 / 25.4));
    expect(scalars.boltPattern.spacing).toBeCloseTo(20 * (96 / 25.4));

    // Verify constant array is normalized
    expect(scalars.gridSpacing).toBeInstanceOf(Array);
    expect(scalars.gridSpacing[0]).toBeCloseTo(15 * (96 / 25.4));
    expect(scalars.gridSpacing[1]).toBeCloseTo(25 * (96 / 25.4));
  });

  it("evaluates member and index access on structured scalars", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      parameters: {
        posisiAwal: {
          type: "point" as any,
          default: [10, 20]
        },
        boltPattern: {
          type: "object" as any,
          default: {
            diameter: 6,
            spacing: 20
          }
        }
      },
      derived: {
        doubleDiameter: "boltPattern.diameter * 2",
        startX: "posisiAwal[0]"
      },
      objects: {}
    };

    const scalars = resolveValues(doc);

    expect(scalars.doubleDiameter).toBe(12);
    expect(scalars.startX).toBe(10);
  });

  it("applies nested partial overrides in resolveValues", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      parameters: {
        posisiAwal: {
          type: "point" as any,
          default: ["10mm", "20mm"]
        },
        boltPattern: {
          type: "object" as any,
          default: {
            diameter: "6mm",
            spacing: "20mm"
          }
        }
      },
      objects: {}
    };

    const scalars = resolveValues(doc, {
      targetUnit: "px",
      overrides: {
        "posisiAwal[0]": 50, // Explicit Override (bypasses mm conversion)
        "boltPattern.diameter": 15 // Explicit Override (bypasses mm conversion)
      }
    });

    expect(scalars.posisiAwal[0]).toBe(50); // Overridden value
    expect(scalars.posisiAwal[1]).toBeCloseTo(20 * (96 / 25.4)); // Default normalized

    expect(scalars.boltPattern.diameter).toBe(15); // Overridden value
    expect(scalars.boltPattern.spacing).toBeCloseTo(20 * (96 / 25.4)); // Default normalized
  });
});
