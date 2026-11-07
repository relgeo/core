import { describe, it, expect } from "vitest";
import { resolveGeometry, resolveValues } from "../resolver";
import type { RelGeoDocument, ResolvedPoint, ResolvedLine, ResolvedCircle, ResolvedRect } from "../types";

describe("resolver values", () => {
  it("should resolve parameters and constants", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      scene: { unit: "cm" },
      parameters: {
        width: { type: "length", default: "100cm" },
      },
      constants: {
        gap: { value: "10cm" },
      },
      objects: {},
    };

    const values = resolveValues(doc);
    expect(values.width).toBe(100);
    expect(values.gap).toBe(10);
  });

  it("should resolve parameters (Standard vs Shorthand)", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      parameters: {
        width: { type: "length", default: "100cm" }, // Standard
        height: "50cm",                             // Shorthand
      },
      objects: {},
    };

    const values = resolveValues(doc, { targetUnit: "cm" });
    expect(values.width).toBe(100);
    expect(values.height).toBe(50);
  });

  it("should resolve constants (Standard vs Shorthand)", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      constants: {
        A: { value: 10 }, // Standard
        B: 20,           // Shorthand
      },
      objects: {},
    };

    const values = resolveValues(doc);
    expect(values.A).toBe(10);
    expect(values.B).toBe(20);
  });

  it("should apply profile overrides to shorthand parameters", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      parameters: {
        size: "10cm",
      },
      profiles: {
        large: { size: "20cm" },
      },
      objects: {},
    };

    const valuesNormal = resolveValues(doc, { targetUnit: "cm" });
    expect(valuesNormal.size).toBe(10);

    const valuesLarge = resolveValues(doc, { profile: "large", targetUnit: "cm" });
    expect(valuesLarge.size).toBe(20);
  });

  it("should apply profile override", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      parameters: {
        size: { type: "length", default: "10px" },
      },
      profiles: {
        large: { size: "50px" },
      },
      objects: {},
    };

    const values = resolveValues(doc, { profile: "large" });
    expect(values.size).toBe(50);
  });

  it("should reject an unknown profile at the core resolver boundary", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      parameters: {
        size: { type: "length", default: "10px" },
      },
      profiles: {
        large: { size: "50px" },
      },
      objects: {},
    };

    expect(() => resolveValues(doc, { profile: "missing" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_REFERENCE",
      path: "profile",
    }));
  });

  it("should apply profile units before evaluating derived geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "cm" },
      parameters: {
        width: { type: "length", default: "10mm" },
      },
      profiles: {
        large: { width: "20mm" },
      },
      derived: {
        doubleWidth: { value: "width * 2" },
      },
      objects: {
        panel: { type: "rect", size: ["doubleWidth", "1cm"] },
      },
    };

    const resolved = resolveGeometry(doc, { profile: "large", targetUnit: "cm" });
    expect(resolved.values.width).toBeCloseTo(2, 8);
    expect(resolved.values.doubleWidth).toBeCloseTo(4, 8);
    expect((resolved.objects.panel as ResolvedRect).width).toBeCloseTo(4, 8);
    expect((resolved.objects.panel as ResolvedRect).height).toBeCloseTo(1, 8);
  });

  it("should resolve derived values with dependencies", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      parameters: {
        base: { type: "number", default: 10 },
      },
      derived: {
        double: { value: "base * 2" },
        triple: { value: "double + base" },
      },
      objects: {},
    };

    const values = resolveValues(doc);
    expect(values.double).toBe(20);
    expect(values.triple).toBe(30);
  });

  it("should throw on circular dependency in derived", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      derived: {
        A: { value: "B + 1" },
        B: { value: "A + 1" },
      },
      objects: {},
    };

    expect(() => resolveValues(doc)).toThrow("Circular dependency");
  });

  it("should resolve direct nested anchors as scalar values", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        box: {
          type: "rect",
          size: [100, 50],
          place: { left: 10, top: 20 },
        },
        point: {
          type: "point",
          at: ["box.center.x", "box.center.y"],
        },
      },
    };

    const resolved = resolveGeometry(doc);
    expect((resolved.objects.point as ResolvedPoint).x).toBe(60);
    expect((resolved.objects.point as ResolvedPoint).y).toBe(45);
  });

  it("should validate align constraint without mutating", () => {
    const doc: RelGeoDocument = {
      version: 0.2,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [100, 0] },
        L1: { type: "line", from: "A", to: "B" },
        refBox: { type: "rect", size: [20, 20], place: { topLeft: [0, 0] } },
      },
      constraints: [
        { align: { target: "L1.start.x", with: "refBox.left" } },
      ],
    };

    const resolved = resolveGeometry(doc);
    expect((resolved.objects.L1 as ResolvedLine).x1).toBe(0);
  });

  it("should throw on constraint violation", () => {
    const doc: RelGeoDocument = {
      version: 0.2,
      objects: {
        A: { type: "point", at: [0, 0] },
        refBox: { type: "rect", size: [20, 20], place: { topLeft: [100, 100] } },
      },
      constraints: [
        { align: { target: "A", with: "refBox.center" } },
      ],
    };

    const result = resolveGeometry(doc);
    expect(result.violations).toBeDefined();
    expect(result.violations!.length).toBeGreaterThan(0);
  });

  it("should apply center origin to resolved geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      scene: { origin: "center" },
      objects: {
        box: {
          type: "rect",
          size: [100, 100],
          place: { left: 0, top: 0 },
        },
      },
    };

    const resolved = resolveGeometry(doc);
    // Resolver should NOT mutate coordinates based on origin anymore
    expect((resolved.objects.box as ResolvedRect).x).toBe(0);
    expect((resolved.objects.box as ResolvedRect).y).toBe(0);
  });

  it("resolves point on line", () => {
    const resolved = resolveGeometry({
      version: 0.1,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [100, 0] },
        L: { type: "line", from: "A", to: "B" },
        P: { type: "point", on: { path: { path: "L", t: 0.5 } } },
      },
    });

    expect((resolved.objects.P as ResolvedPoint).x).toBe(50);
    expect((resolved.objects.P as ResolvedPoint).y).toBe(0);
  });

  it("should resolve pointShape and color to meta properties", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      parameters: {
        themeColor: { type: "string", default: "red" },
        shapeType: { type: "string", default: "cross" },
      },
      objects: {
        P: {
          type: "point",
          at: [10, 20],
          pointShape: "shapeType",
          color: "themeColor",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const p = resolved.objects.P as ResolvedPoint;
    expect(p.meta).toBeDefined();
    expect(p.meta?.pointShape).toBe("cross");
    expect(p.meta?.color).toBe("red");
  });

  it("should apply object meta preset and let object meta override it", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      metaPresets: {
        guideLine: {
          stroke: "#999999",
          strokeWidth: 1,
        },
      },
      objects: {
        centerLine: {
          type: "line",
          from: [0, 0],
          to: [100, 0],
          metaPreset: "guideLine",
          meta: {
            strokeWidth: 2,
          },
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const line = resolved.objects.centerLine as ResolvedLine;
    expect(line.meta?.stroke).toBe("#999999");
    expect(line.meta?.strokeWidth).toBe(2);
  });

  it("should resolve ellipse from size and expose anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        ovalArea: "area(oval)",
      },
      objects: {
        oval: {
          type: "ellipse",
          center: [100, 50],
          size: [80, 40],
        } as any,
      },
    };

    const resolved = resolveGeometry(doc);
    const oval = resolved.objects.oval as any;
    expect(oval.type).toBe("ellipse");
    expect(oval.rx).toBe(40);
    expect(oval.ry).toBe(20);
    expect(oval.cx).toBe(100);
    expect(oval.cy).toBe(50);
    expect(resolved.values.ovalArea).toBeCloseTo(Math.PI * 40 * 20);
  });

  it("should resolve rotated ellipse pointAt", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        px: "pointAt(oval, 0).x",
        py: "pointAt(oval, 0).y",
      },
      objects: {
        oval: {
          type: "ellipse",
          center: [0, 0],
          rx: 10,
          ry: 5,
          rotation: Math.PI / 2,
        } as any,
      },
    };

    const resolved = resolveGeometry(doc);
    expect(resolved.values.px).toBeCloseTo(0, 5);
    expect(resolved.values.py).toBeCloseTo(10, 5);
  });

  it("should still resolve style alias against styles map for backward compatibility", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      styles: {
        guideLine: {
          stroke: "#999999",
          strokeWidth: 1,
        },
      },
      objects: {
        centerLine: {
          type: "line",
          from: [0, 0],
          to: [100, 0],
          style: "guideLine",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const line = resolved.objects.centerLine as ResolvedLine;
    expect(line.meta?.stroke).toBe("#999999");
    expect(line.meta?.strokeWidth).toBe(1);
  });

  it("keeps canonical metadata and both compatibility aliases semantically equivalent", () => {
    const base = {
      type: "line" as const,
      from: [0, 0] as [number, number],
      to: [100, 0] as [number, number],
    };
    const canonical = resolveGeometry({
      version: 0.5,
      metaPresets: { guide: { stroke: "#123456", strokeWidth: 2 } },
      objects: { line: { ...base, metaPreset: "guide" } },
    });
    const rootAlias = resolveGeometry({
      version: 0.5,
      styles: { guide: { stroke: "#123456", strokeWidth: 2 } },
      objects: { line: { ...base, style: "guide" } },
    });

    const canonicalLine = canonical.objects.line as ResolvedLine;
    const aliasLine = rootAlias.objects.line as ResolvedLine;
    expect(aliasLine).toMatchObject({
      type: canonicalLine.type,
      x1: canonicalLine.x1,
      y1: canonicalLine.y1,
      x2: canonicalLine.x2,
      y2: canonicalLine.y2,
      meta: canonicalLine.meta,
    });
  });

  it("should resolve translate operation objects as reusable geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        movedLength: "length(moved)",
        movedMidX: "pointAt(moved, 0.5).x",
        movedMidY: "pointAt(moved, 0.5).y",
      },
      objects: {
        base: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        moved: {
          type: "translate",
          target: "base",
          by: [5, 7],
        } as any,
        marker: {
          type: "point",
          at: "moved.end",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const moved = resolved.objects.moved as any;
    const marker = resolved.objects.marker as ResolvedPoint;

    expect(moved.type).toBe("translate");
    expect(marker.x).toBeCloseTo(15);
    expect(marker.y).toBeCloseTo(7);
    expect(resolved.values.movedLength).toBeCloseTo(10);
    expect(resolved.values.movedMidX).toBeCloseTo(10);
    expect(resolved.values.movedMidY).toBeCloseTo(7);
  });

  it("should resolve rotate operation objects with transformed anchors and pointAt", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        turnedEndX: "pointAt(turned, 1).x",
        turnedEndY: "pointAt(turned, 1).y",
      },
      objects: {
        base: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        turned: {
          type: "rotate",
          target: "base",
          angle: "90deg",
          origin: [0, 0],
        } as any,
        marker: {
          type: "point",
          at: "turned.end",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const turned = resolved.objects.turned as any;
    const marker = resolved.objects.marker as ResolvedPoint;

    expect(turned.type).toBe("rotate");
    expect(marker.x).toBeCloseTo(0, 5);
    expect(marker.y).toBeCloseTo(10, 5);
    expect(resolved.values.turnedEndX).toBeCloseTo(0, 5);
    expect(resolved.values.turnedEndY).toBeCloseTo(10, 5);
  });

  it("should resolve scale and mirror operation objects as transform-bearing geometry nodes", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        base: {
          type: "line",
          from: [2, 3],
          to: [6, 3],
        },
        scaled: {
          type: "scale",
          target: "base",
          factor: [2, 3],
          origin: [0, 0],
        } as any,
        mirrored: {
          type: "mirror",
          target: "base",
          axis: "y",
          origin: [0, 0],
        } as any,
        scaledMarker: {
          type: "point",
          at: "scaled.end",
        },
        mirroredMarker: {
          type: "point",
          at: "mirrored.end",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const scaled = resolved.objects.scaled as any;
    const mirrored = resolved.objects.mirrored as any;
    const scaledMarker = resolved.objects.scaledMarker as ResolvedPoint;
    const mirroredMarker = resolved.objects.mirroredMarker as ResolvedPoint;

    expect(scaled.type).toBe("scale");
    expect(mirrored.type).toBe("mirror");
    expect(scaledMarker.x).toBeCloseTo(12);
    expect(scaledMarker.y).toBeCloseTo(9);
    expect(mirroredMarker.x).toBeCloseTo(6);
    expect(mirroredMarker.y).toBeCloseTo(-3);
  });

  it("should resolve reverse operation objects with reversed traversal semantics", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        reversedStartX: "pointAt(reversed, 0).x",
        reversedStartY: "pointAt(reversed, 0).y",
        reversedEndX: "pointAt(reversed, 1).x",
        reversedEndY: "pointAt(reversed, 1).y",
        tangentX: "tangentAt(reversed, 0.25).x",
        tangentY: "tangentAt(reversed, 0.25).y",
        reversedLength: "length(reversed)",
      },
      objects: {
        base: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        reversed: {
          type: "reverse",
          target: "base",
        } as any,
        startMarker: {
          type: "point",
          at: "reversed.start",
        },
        endMarker: {
          type: "point",
          at: "reversed.end",
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const reversed = resolved.objects.reversed as any;
    const startMarker = resolved.objects.startMarker as ResolvedPoint;
    const endMarker = resolved.objects.endMarker as ResolvedPoint;

    expect(reversed.type).toBe("reverse");
    expect(startMarker.x).toBeCloseTo(10);
    expect(startMarker.y).toBeCloseTo(0);
    expect(endMarker.x).toBeCloseTo(0);
    expect(endMarker.y).toBeCloseTo(0);
    expect(resolved.values.reversedStartX).toBeCloseTo(10);
    expect(resolved.values.reversedStartY).toBeCloseTo(0);
    expect(resolved.values.reversedEndX).toBeCloseTo(0);
    expect(resolved.values.reversedEndY).toBeCloseTo(0);
    expect(resolved.values.tangentX).toBeCloseTo(-1);
    expect(resolved.values.tangentY).toBeCloseTo(0);
    expect(resolved.values.reversedLength).toBeCloseTo(10);
  });

  it("should reject reverse targets without reversible traversal", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        guide: {
          type: "point",
          at: [5, 5],
        },
        reversed: {
          type: "reverse",
          target: "guide",
        } as any,
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("INVALID_REVERSE_TARGET");
  });

  it("should reject non-finite transform values", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        base: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        moved: {
          type: "translate",
          target: "base",
          by: [Number.POSITIVE_INFINITY, 0],
        } as any,
      },
    };

    expect(() => resolveGeometry(doc)).toThrow(/Operation "moved" contains non-finite transform values/);
  });

  it("should resolve path join even when targets are declared later", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        outlineLength: "length(outline)",
      },
      objects: {
        outline: {
          type: "path",
          join: ["top", "right"],
        } as any,
        top: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        right: {
          type: "line",
          from: [10, 0],
          to: [10, 5],
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const outline = resolved.objects.outline as any;

    expect(outline.type).toBe("path");
    expect(outline.segments).toHaveLength(2);
    expect(outline.points[0]).toEqual({ x: 0, y: 0 });
    expect(outline.points[1]).toEqual({ x: 10, y: 0 });
    expect(outline.points[2]).toEqual({ x: 10, y: 5 });
    expect(resolved.values.outlineLength).toBeCloseTo(15);
  });

  it("should close joined paths with closeWith line", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      derived: {
        areaValue: "area(outline)",
      },
      objects: {
        outline: {
          type: "path",
          join: ["top", "right", "bottom"],
          closed: true,
          closeWith: "line",
        } as any,
        top: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        right: {
          type: "line",
          from: [10, 0],
          to: [10, 10],
        },
        bottom: {
          type: "line",
          from: [10, 10],
          to: [0, 10],
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const outline = resolved.objects.outline as any;
    const lastSegment = outline.segments[outline.segments.length - 1];

    expect(outline.closed).toBe(true);
    expect(outline.segments).toHaveLength(4);
    expect(lastSegment.type).toBe("line");
    expect(lastSegment.x1).toBeCloseTo(0);
    expect(lastSegment.y1).toBeCloseTo(10);
    expect(lastSegment.x2).toBeCloseTo(0);
    expect(lastSegment.y2).toBeCloseTo(0);
    expect(resolved.values.areaValue).toBeCloseTo(100);
  });

  it("should allow explicit reverse objects inside path join", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        outline: {
          type: "path",
          join: ["top", "rightReversed"],
        } as any,
        top: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        right: {
          type: "line",
          from: [10, 10],
          to: [10, 0],
        },
        rightReversed: {
          type: "reverse",
          target: "right",
        } as any,
      },
    };

    const resolved = resolveGeometry(doc);
    const outline = resolved.objects.outline as any;

    expect(outline.segments).toHaveLength(2);
    expect(outline.points[0]).toEqual({ x: 0, y: 0 });
    expect(outline.points[1]).toEqual({ x: 10, y: 0 });
    expect(outline.points[2]).toEqual({ x: 10, y: 10 });
  });

  it("should reject path join direction mismatch without implicit reverse", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        outline: {
          type: "path",
          join: ["top", "right"],
        } as any,
        top: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
        },
        right: {
          type: "line",
          from: [10, 10],
          to: [10, 0],
        },
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("PATH_JOIN_DIRECTION_MISMATCH");
  });

  it("should reject closeWith outside closed join mode", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      objects: {
        outline: {
          type: "path",
          points: [
            [0, 0],
            [10, 0],
          ],
          closeWith: "line",
        } as any,
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("INVALID_CLOSE_WITH");
  });
});
