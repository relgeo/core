import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument, ResolvedDimension, ResolvedAnnotation, ResolvedText } from "../types";

describe("Dimension and Annotation layout system", () => {
  describe("Dimension Primitive", () => {
    it("should resolve linear dimension with distance and custom text template", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "mm" },
        objects: {
          P1: { type: "point", at: [10, 10] },
          P2: { type: "point", at: [40, 50] }, // Distance is Math.hypot(30, 40) = 50
          D1: {
            type: "dimension",
            kind: "linear",
            from: "P1",
            to: "P2",
            offset: 15,
            text: "Distance: {distance} measured"
          }
        }
      };

      const res = resolveGeometry(doc);
      const D1 = res.objects.D1 as ResolvedDimension;
      expect(D1.type).toBe("dimension");
      expect(D1.kind).toBe("linear");
      expect(D1.distance).toBeCloseTo(50);
      expect(D1.offset).toBe(15);
      expect(D1.text).toBe("Distance: 50mm measured");
    });

    it("should resolve radius dimension targeting circle", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "cm" },
        objects: {
          C1: {
            type: "circle",
            center: [50, 50],
            radius: 20
          },
          D1: {
            type: "dimension",
            kind: "radius",
            target: "C1",
            text: "R={radius}"
          }
        }
      };

      const res = resolveGeometry(doc);
      const D1 = res.objects.D1 as ResolvedDimension;
      expect(D1.type).toBe("dimension");
      expect(D1.kind).toBe("radius");
      expect(D1.distance).toBe(20);
      expect(D1.text).toBe("R=20cm");
    });

    it("should resolve diameter dimension targeting circle", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "px" },
        objects: {
          C1: {
            type: "circle",
            center: [50, 50],
            radius: 20
          },
          D1: {
            type: "dimension",
            kind: "diameter",
            target: "C1",
            text: "Dia: {diameter}"
          }
        }
      };

      const res = resolveGeometry(doc);
      const D1 = res.objects.D1 as ResolvedDimension;
      expect(D1.type).toBe("dimension");
      expect(D1.kind).toBe("diameter");
      expect(D1.distance).toBe(40);
      expect(D1.text).toBe("Dia: 40px");
    });

    it("should resolve angle dimension between two lines", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          // Horizontal line
          L1: {
            type: "line",
            from: [0, 0],
            to: [100, 0]
          },
          // 45 degree line
          L2: {
            type: "line",
            from: [0, 0],
            to: [100, 100]
          },
          D1: {
            type: "dimension",
            kind: "angle",
            between: ["L1", "L2"],
            text: "Angle: {angle}"
          }
        }
      };

      const res = resolveGeometry(doc);
      const D1 = res.objects.D1 as ResolvedDimension;
      expect(D1.type).toBe("dimension");
      expect(D1.kind).toBe("angle");
      expect(D1.angle).toBeCloseTo(45);
      expect(D1.text).toBe("Angle: 45°");
    });

    it("should throw DIMENSION_TARGET_INVALID when targets are invalid", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          D1: {
            type: "dimension",
            kind: "linear",
            from: "NonExistentPoint",
            to: [0, 0]
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/DIMENSION_TARGET_INVALID/);
    });
  });

  describe("Annotation Primitive", () => {
    it("should resolve text placement using spec default font size when metadata is absent", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          T1: {
            type: "text",
            content: "Hello",
            place: { left: 100, top: 40 }
          }
        }
      };

      const res = resolveGeometry(doc, {
        textMetrics: {
          measure: ({ content, fontSize }) => ({
            width: String(content).length * fontSize * 0.5,
            height: fontSize,
            ascent: fontSize * 0.8,
            descent: fontSize * 0.2,
          }),
        },
      });
      const T1 = res.objects.T1 as ResolvedText;
      expect(T1.width).toBe(30);
      expect(T1.height).toBe(12);
      expect(T1.x).toBe(100);
      expect(T1.y).toBe(40);
    });

    it("should resolve annotation with custom text and placement", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          P1: { type: "point", at: [10, 10] },
          A1: {
            type: "annotation",
            target: "P1",
            text: "Note: {P1.x}, {P1.y}",
            place: { center: [50, 50] }
          }
        }
      };

      const res = resolveGeometry(doc);
      const A1 = res.objects.A1 as ResolvedAnnotation;
      expect(A1.type).toBe("annotation");
      expect(A1.target).toBe("P1");
      expect(A1.text).toBe("Note: 10, 10");
      expect(A1.place).toBeDefined();
      expect(A1.place.x).toBe(50 - A1.place.width / 2);
      expect(A1.place.y).toBe(50 - A1.place.height / 2);
    });

    it("should resolve annotation with leader lines", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          P1: { type: "point", at: [10, 10] },
          A1: {
            type: "annotation",
            text: "Leader Note",
            leader: {
              from: "P1",
              to: [100, 100]
            }
          }
        }
      };

      const res = resolveGeometry(doc);
      const A1 = res.objects.A1 as ResolvedAnnotation;
      expect(A1.type).toBe("annotation");
      expect(A1.leader).toBeDefined();
      expect(A1.leader!.from.x).toBe(10);
      expect(A1.leader!.from.y).toBe(10);
      expect(A1.leader!.to.x).toBe(100);
      expect(A1.leader!.to.y).toBe(100);
    });

    it("should synthesize fallback placement for target-only annotation", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          hole: {
            type: "circle",
            center: [50, 50],
            radius: 10
          },
          note: {
            type: "annotation",
            target: "hole",
            text: "M6 clearance"
          }
        }
      };

      const res = resolveGeometry(doc, {
        textMetrics: {
          measure: ({ content, fontSize }) => ({
            width: String(content).length * fontSize * 0.5,
            height: fontSize,
            ascent: fontSize * 0.8,
            descent: fontSize * 0.2,
          }),
        },
      });
      const note = res.objects.note as ResolvedAnnotation;
      expect(note.target).toBe("hole");
      expect(note.place).toBeDefined();
      expect(note.place.x).toBeGreaterThan(60);
      expect(note.place.y).toBeCloseTo(44, 0.0001);
      expect(note.place.width).toBe(72);
      expect(note.place.height).toBe(12);
    });

    it("should throw ANNOTATION_TARGET_INVALID when leader target is invalid", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          A1: {
            type: "annotation",
            text: "Invalid Target Leader",
            leader: {
              from: "NonExistentTarget",
              to: [10, 10]
            }
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/ANNOTATION_TARGET_INVALID/);
    });
  });
});
