import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument, ResolvedRect, ResolvedPoint, ResolvedLine, ResolvedArc, ResolvedQuadratic, ResolvedCubic, ResolvedPath, ResolvedPolygon } from "../types";
import { calculateBoundingBox } from "../resolver/geometry-utils";
import { getAnchorValue } from "../resolver/anchors";
import { Validator } from "../validator";

describe("resolver geometry", () => {
  it("should resolve a root rect at origin", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        tanah: {
          type: "rect",
          size: [100, 200],
        },
      },
    };

    const res = resolveGeometry(doc);
    const tanah = res.objects.tanah as ResolvedRect;
    expect(tanah.x).toBe(0);
    expect(tanah.y).toBe(0);
    expect(tanah.width).toBe(100);
    expect(tanah.height).toBe(200);
  });

  it("should resolve rect with absolute placement", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        box: {
          type: "rect",
          size: [50, 50],
          place: {
            left: 10,
            top: 20,
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const box = res.objects.box as ResolvedRect;
    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
  });

  it("should resolve rect relative to another rect", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        tanah: {
          type: "rect",
          size: [100, 100],
        },
        rumah: {
          type: "rect",
          size: [40, 40],
          place: {
            centerX: "tanah.centerX",
            bottom: "tanah.bottom",
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const rumah = res.objects.rumah as ResolvedRect;
    // tanah is at 0,0 size 100,100 -> centerX=50, bottom=100
    // rumah size 40,40
    // x = centerX - width/2 = 50 - 20 = 30
    // y = bottom - height = 100 - 40 = 60
    expect(rumah.x).toBe(30);
    expect(rumah.y).toBe(60);
  });

  it("should resolve rect using point anchors (topLeft and center)", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        anchorObj: {
          type: "rect",
          size: [100, 100],
          place: { left: 50, top: 50 },
        },
        child1: {
          type: "rect",
          size: [20, 20],
          place: {
            topLeft: "anchorObj.center",
          },
        },
        child2: {
          type: "rect",
          size: [30, 30],
          place: {
            center: "anchorObj.bottomRight",
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    // anchorObj: x=50, y=50, w=100, h=100 -> center=(100, 100), bottomRight=(150, 150)
    
    // child1: topLeft=center=(100, 100) -> x=100, y=100
    const child1 = res.objects.child1 as ResolvedRect;
    expect(child1.x).toBe(100);
    expect(child1.y).toBe(100);

    // child2: center=bottomRight=(150, 150) -> x = 150 - 15 = 135, y = 150 - 15 = 135
    const child2 = res.objects.child2 as ResolvedRect;
    expect(child2.x).toBe(135);
    expect(child2.y).toBe(135);
  });

  it("should resolve points (absolute, relative, on segment)", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        A: { type: "point", at: "origin" },
        B: {
          type: "point",
          from: "A",
          move: { right: 100, down: 50 },
        },
        L_AB: { type: "line", from: "A", to: "B" },
        C: {
          type: "point",
          on: { path: { path: "L_AB", t: 0.5 } },
        },
        box: {
          type: "rect",
          size: [20, 20],
          place: {
            center: "C.center",
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const A = res.objects.A as ResolvedPoint;
    const B = res.objects.B as ResolvedPoint;
    const C = res.objects.C as ResolvedPoint;
    const box = res.objects.box as ResolvedRect;

    expect(A.x).toBe(0);
    expect(A.y).toBe(0);

    expect(B.x).toBe(100);
    expect(B.y).toBe(50);

    // C is at 0.5 of [0,0] and [100,50] -> (50, 25)
    expect(C.x).toBe(50);
    expect(C.y).toBe(25);

    // box center is C(50, 25) -> x = 50 - 10 = 40, y = 25 - 10 = 15
    expect(box.x).toBe(40);
    expect(box.y).toBe(15);
  });

  it("requires complete polar point movement and rejects mixed movement modes", () => {
    const incompletePolar = {
      version: 0.5,
      objects: {
        p: { type: "point", from: [0, 0], move: { angle: "45deg" } },
      },
    } as any;
    expect(() => new Validator(incompletePolar).validate()).toThrow(/MISSING_REQUIRED_FIELD/);

    const mixedModes = {
      version: 0.5,
      objects: {
        p: { type: "point", from: [0, 0], move: { angle: "45deg", distance: 10, right: 2 } },
      },
    } as any;
    expect(() => new Validator(mixedModes).validate()).toThrow(/OVER_CONSTRAINED/);
  });

  it("should resolve lines (from-to, direction+length)", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        A: { type: "point", at: [10, 10] },
        B: { type: "point", at: [100, 100] },
        L1: { type: "line", from: "A", to: "B" },
        L2: {
          type: "line",
          from: "B",
          direction: "right",
          length: 50,
        },
        C: {
          type: "point",
          from: "L1.center",
        },
      },
    };

    const res = resolveGeometry(doc);
    const L1 = res.objects.L1 as ResolvedLine;
    const L2 = res.objects.L2 as ResolvedLine;
    const C = res.objects.C as ResolvedPoint;

    expect(L1.x1).toBe(10);
    expect(L1.y1).toBe(10);
    expect(L1.x2).toBe(100);
    expect(L1.y2).toBe(100);

    expect(L2.x1).toBe(100);
    expect(L2.y1).toBe(100);
    expect(L2.x2).toBe(150);
    expect(L2.y2).toBe(100);

    // L1 center is (55, 55)
    expect(C.x).toBe(55);
    expect(C.y).toBe(55);
  });

  it("rejects non-finite primitive coordinates before publishing a scene", () => {
    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        badPoint: { type: "point", at: [Number.NaN, 0] } as any,
      },
    })).toThrow(/INVALID_VALUE/);

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        badEllipse: { type: "ellipse", center: [0, 0], rx: Number.NaN, ry: 10 } as any,
      },
    })).toThrow(/INVALID_VALUE/);

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        badCurve: {
          type: "quadratic",
          from: [0, 0],
          cp: [Number.NaN, 5],
          to: [10, 0],
        } as any,
      },
    })).toThrow(/INVALID_VALUE/);
  });

  it("rejects degenerate closed-shape dimensions before publishing a scene", () => {
    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        flatRect: { type: "rect", size: [0, 10] } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      objectId: "flatRect",
      path: "size",
    }));

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        negativeCircle: { type: "circle", center: [0, 0], radius: -1 } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      objectId: "negativeCircle",
      path: "radius",
    }));

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        zeroThroughCircle: { type: "circle", center: [0, 0], through: [0, 0] } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      objectId: "zeroThroughCircle",
      path: "radius",
    }));

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        flatEllipse: { type: "ellipse", center: [0, 0], rx: 0, ry: 10 } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "ELLIPSE_INVALID_RADIUS",
      objectId: "flatEllipse",
      path: "radius",
    }));

    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        flatArc: {
          type: "arc",
          center: [0, 0],
          radius: 0,
          startAngle: 0,
          endAngle: Math.PI / 2,
        } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "DEGENERATE_ARC",
      objectId: "flatArc",
      path: "radius",
    }));
  });

  it("rejects non-positive direction-length line modes with field context", () => {
    expect(() => resolveGeometry({
      version: 0.5,
      objects: {
        degenerateLine: { type: "line", from: [0, 0], direction: "right", length: 0 } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      path: "objects.degenerateLine.length",
    }));

    expect(() => resolveGeometry({
      version: 0.5,
      parameters: {
        zeroLength: { type: "number", default: 0 },
      },
      objects: {
        degenerateLine: { type: "line", from: [0, 0], direction: "right", length: "zeroLength" } as any,
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      objectId: "degenerateLine",
      path: "length",
    }));
  });

  it("should throw on circular dependency between objects", () => {
    const doc: RelGeoDocument = {
      version: 0.1,
      objects: {
        A: { type: "point", from: "B" },
        B: { type: "point", from: "A" },
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("Circular dependency");
  });

  it("should resolve line tangent to circle from external point", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [20, 0] },
        c1: { type: "circle", center: [0, 0], radius: 10 },
        t1: {
          type: "line",
          from: "A",
          tangent: {
            from: "A",
            to: "c1",
            pick: "first",
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const t1 = res.objects.t1 as ResolvedLine;
    const tangentPointDistance = Math.hypot(t1.x2, t1.y2);
    const tangentDot = (t1.x2 - 0) * (t1.x2 - t1.x1) + (t1.y2 - 0) * (t1.y2 - t1.y1);

    expect(t1.x1).toBe(20);
    expect(t1.y1).toBe(0);
    expect(tangentPointDistance).toBeCloseTo(10);
    expect(tangentDot).toBeCloseTo(0, 5);
  });

  it("should throw TANGENT_NOT_FOUND for tangent from point inside circle", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [5, 0] },
        c1: { type: "circle", center: [0, 0], radius: 10 },
        t1: {
          type: "line",
          from: "A",
          tangent: {
            from: "A",
            to: "c1",
          },
        },
      },
    };

    expect(() => resolveGeometry(doc)).toThrow("TANGENT_NOT_FOUND");
  });

  it("should enforce tangent constraint for line-circle pair", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [20, 0] },
        c1: { type: "circle", center: [0, 0], radius: 10 },
        t1: {
          type: "line",
          from: "A",
          tangent: {
            from: "A",
            to: "c1",
            pick: "first",
          },
        },
      },
      constraints: [{ tangent: ["t1", "c1"] }],
    };

    expect(() => resolveGeometry(doc)).not.toThrow();
  });

  it("should fail tangent constraint when line cuts through circle", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [-20, 0] },
        B: { type: "point", at: [20, 0] },
        c1: { type: "circle", center: [0, 0], radius: 10 },
        l1: { type: "line", from: "A", to: "B" },
      },
      constraints: [{ tangent: ["l1", "c1"] }],
    };

    const result = resolveGeometry(doc);
    expect(result.violations).toBeDefined();
    expect(result.violations!.length).toBeGreaterThan(0);
  });

  it("should resolve arc from center-radius mode", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        arc1: {
          type: "arc",
          center: [50, 50],
          radius: 20,
          startAngle: "0deg",
          endAngle: "90deg",
        },
      },
    };

    const res = resolveGeometry(doc);
    const arc = res.objects.arc1 as ResolvedArc;

    expect(arc.cx).toBe(50);
    expect(arc.cy).toBe(50);
    expect(arc.radius).toBe(20);
    expect(arc.x1).toBeCloseTo(70);
    expect(arc.y1).toBeCloseTo(50);
    expect(arc.x2).toBeCloseTo(50);
    expect(arc.y2).toBeCloseTo(70);
    expect(arc.sweep).toBe(1);
  });

  it("should resolve arc from three-point mode", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 10] },
        C: { type: "point", at: [20, 0] },
        arc1: {
          type: "arc",
          from: "A",
          through: "B",
          to: "C",
        },
      },
    };

    const res = resolveGeometry(doc);
    const arc = res.objects.arc1 as ResolvedArc;

    expect(arc.cx).toBeCloseTo(10);
    expect(arc.cy).toBeCloseTo(0);
    expect(arc.radius).toBeCloseTo(10);
    expect(arc.xt).toBe(10);
    expect(arc.yt).toBe(10);
    expect(arc.largeArc).toBe(0);
  });

  it("should resolve quadratic bezier control geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 20] },
        C: { type: "point", at: [30, 0] },
        q1: {
          type: "quadratic",
          from: "A",
          cp: "B",
          to: "C",
        },
      },
    };

    const res = resolveGeometry(doc);
    const q1 = res.objects.q1 as ResolvedQuadratic;

    expect(q1.x1).toBe(0);
    expect(q1.y1).toBe(0);
    expect(q1.cpx).toBe(10);
    expect(q1.cpy).toBe(20);
    expect(q1.x2).toBe(30);
    expect(q1.y2).toBe(0);
  });

  it("should resolve cubic bezier control geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 20] },
        C: { type: "point", at: [20, 20] },
        D: { type: "point", at: [30, 0] },
        c1: {
          type: "cubic",
          from: "A",
          cp1: "B",
          cp2: "C",
          to: "D",
        },
      },
    };

    const res = resolveGeometry(doc);
    const c1 = res.objects.c1 as ResolvedCubic;

    expect(c1.x1).toBe(0);
    expect(c1.y1).toBe(0);
    expect(c1.cp1x).toBe(10);
    expect(c1.cp1y).toBe(20);
    expect(c1.cp2x).toBe(20);
    expect(c1.cp2y).toBe(20);
    expect(c1.x2).toBe(30);
    expect(c1.y2).toBe(0);
  });

  it("should resolve segmented path runtime with mixed segment types", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [20, 0] },
        C: { type: "point", at: [30, 10] },
        D: { type: "point", at: [40, 0] },
        E: { type: "point", at: [50, 10] },
        F: { type: "point", at: [60, 10] },
        G: { type: "point", at: [70, 0] },
        shape: {
          type: "path",
          segments: [
            { line: { from: "A", to: "B" } },
            { quadratic: { cp: "C", to: "D" } },
            { cubic: { cp1: "E", cp2: "F", to: "G" } },
          ],
        },
      },
    };

    const res = resolveGeometry(doc);
    const shape = res.objects.shape as ResolvedPath;

    expect(shape.closed).toBeUndefined();
    expect(shape.segments).toHaveLength(3);
    expect(shape.segments?.[0].type).toBe("line");
    expect(shape.segments?.[1].type).toBe("quadratic");
    expect(shape.segments?.[2].type).toBe("cubic");
    expect(shape.points?.[0]).toEqual({ x: 0, y: 0 });
    expect(shape.points?.at(-1)).toEqual({ x: 70, y: 0 });
  });

  it("should resolve arc segment with circular data", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 10] },
        C: { type: "point", at: [20, 0] },
        shape: {
          type: "path",
          segments: [
            { line: { from: "A", to: "A" } },
            { arc: { through: "B", to: "C" } },
          ],
        },
      },
    };

    const res = resolveGeometry(doc);
    const shape = res.objects.shape as ResolvedPath;
    const arc = shape.segments?.[1];

    expect(arc?.type).toBe("arc");
    if (arc?.type === "arc") {
      expect(arc.radius).toBeCloseTo(10);
      expect(arc.cx).toBeCloseTo(10);
      expect(arc.cy).toBeCloseTo(0);
    }
  });

  it("should resolve polygon and expose derived scalar properties", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [40, 0] },
        C: { type: "point", at: [40, 20] },
        D: { type: "point", at: [0, 20] },
        poly: {
          type: "polygon",
          points: ["A", "B", "C", "D"],
        },
        box: {
          type: "rect",
          size: ["poly.width", 10],
          place: {
            center: "poly.center",
          },
        },
        areaMarker: {
          type: "point",
          at: ["poly.area", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const poly = res.objects.poly as ResolvedPolygon;
    const box = res.objects.box as ResolvedRect;
    const areaMarker = res.objects.areaMarker as ResolvedPoint;

    expect(poly.points).toHaveLength(4);
    expect(box.width).toBe(40);
    expect(box.x).toBe(0);
    expect(box.y).toBe(5);
    expect(areaMarker.x).toBe(800);
  });

  it("should expose derived bbox scalars for quadratic and cubic", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 20] },
        C: { type: "point", at: [20, 20] },
        D: { type: "point", at: [30, 0] },
        q1: { type: "quadratic", from: "A", cp: "B", to: "D" },
        c1: { type: "cubic", from: "A", cp1: "B", cp2: "C", to: "D" },
        qBox: {
          type: "rect",
          size: ["q1.width", 4],
          place: { centerX: "q1.centerX", top: "q1.top" },
        },
        cBox: {
          type: "rect",
          size: ["c1.width", 4],
          place: { centerX: "c1.centerX", top: "c1.top" },
        },
      },
    };

    const res = resolveGeometry(doc);
    const qBox = res.objects.qBox as ResolvedRect;
    const cBox = res.objects.cBox as ResolvedRect;

    expect(qBox.width).toBe(30);
    expect(qBox.x).toBe(0);
    expect(qBox.y).toBe(0);
    expect(cBox.width).toBe(30);
    expect(cBox.x).toBe(0);
    expect(cBox.y).toBe(0);
  });

  it("should expose length-derived scalars for curve and path primitives", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 20] },
        C: { type: "point", at: [30, 0] },
        q1: { type: "quadratic", from: "A", cp: "B", to: "C" },
        p1: {
          type: "path",
          points: ["A", "B", "C"],
        },
        qLenMarker: {
          type: "point",
          at: ["q1.length", 0],
        },
        pLenMarker: {
          type: "point",
          at: ["p1.length", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const qLenMarker = res.objects.qLenMarker as ResolvedPoint;
    const pLenMarker = res.objects.pLenMarker as ResolvedPoint;

    expect(qLenMarker.x).toBeGreaterThan(30);
    expect(pLenMarker.x).toBeCloseTo(
      Math.hypot(10, 20) + Math.hypot(20, -20)
    );
  });

  it("should throw PATH_NOT_CLOSED for closed path whose endpoints do not meet", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [20, 0] },
        C: { type: "point", at: [20, 10] },
        bad: {
          type: "path",
          closed: true,
          points: ["A", "B", "C"],
        },
      },
    };

    expect(() => resolveGeometry(doc, { mode: "validate" })).toThrow("PATH_NOT_CLOSED");
  });

  it("should allow closed path when endpoints coincide", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [20, 0] },
        C: { type: "point", at: [20, 10] },
        ok: {
          type: "path",
          closed: true,
          points: ["A", "B", "C", "A"],
        },
      },
    };

    const res = resolveGeometry(doc, { mode: "validate" });
    const ok = res.objects.ok as ResolvedPath;
    expect(ok.closed).toBe(true);
  });

  it("should apply corner modifiers to closed path geometry", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        box: {
          type: "path",
          closed: true,
          points: [[0, 0], [20, 0], [20, 20], [0, 20]],
          corners: {
            1: { chamfer: 4 },
            3: { fillet: 3 },
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const box = res.objects.box as ResolvedPath;

    expect(box.segments?.some((segment) => segment.type === "arc")).toBe(true);
    expect((box.segments?.length ?? 0)).toBeGreaterThan(4);
  });

  it("should render top-left fillet on closed point-path as a small corner arc", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        ModPath: {
          type: "path",
          closed: true,
          points: [[50, 250], [250, 250], [250, 350], [50, 350]],
          corners: {
            0: { fillet: 10 },
            3: { fillet: 10 },
            1: { chamfer: 15 },
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const modPath = res.objects.ModPath as ResolvedPath;
    const arcSegs = (modPath.segments ?? []).filter((segment) => segment.type === "arc") as any[];
    expect(arcSegs).toHaveLength(2);

    const topLeftArc = arcSegs.find((segment) => segment.x1 < 70 && segment.y2 < 270);
    expect(topLeftArc).toBeDefined();
    expect(topLeftArc.largeArc).toBe(0);
  });

  it("should resolve offset path from polygon source", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        poly: {
          type: "polygon",
          points: [[0, 0], [20, 0], [20, 20], [0, 20]],
        },
        outline: {
          type: "path",
          offset: {
            from: "poly",
            distance: 5,
            side: "outside",
          },
        },
      },
    };

    const res = resolveGeometry(doc);
    const outline = res.objects.outline as ResolvedPath;

    expect(outline.closed).toBe(true);
    expect(outline.points?.length).toBeGreaterThanOrEqual(4);
    expect(outline.segments?.length).toBeGreaterThanOrEqual(4);
  });

  it("should expose area on closed offset path inherited from closed source", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        poly: {
          type: "polygon",
          points: [[0, 0], [20, 0], [20, 20], [0, 20]],
        },
        outline: {
          type: "path",
          offset: {
            from: "poly",
            distance: 5,
            side: "outside",
          },
        },
        marker: {
          type: "point",
          at: ["outline.area", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeGreaterThan(0);
  });

  it("should resolve text content interpolation from geometry queries", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        L: { type: "line", from: "A", to: "B" },
        label: {
          type: "text",
          at: [0, 0],
          content: "Length: {length(L)}",
        },
      },
    };

    const res = resolveGeometry(doc);
    const label = res.objects.label as any;
    expect(String(label.content)).toContain("Length: 10");
  });

  it("should use arc extrema for path bbox-derived anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        start: { type: "point", at: [9.84807753, 1.73648178] },
        curve: {
          type: "path",
          segments: [
            {
              line: {
                from: "start",
                to: "start",
              },
            },
            {
              arc: {
                through: [7.07106781, 7.07106781],
                to: [-9.84807753, 1.73648178],
              },
            },
          ],
        },
        marker: {
          type: "point",
          at: ["curve.bottom", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeCloseTo(10, 4);
  });

  it("should expose modifier-aware polygon area through derived anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        rounded: {
          type: "polygon",
          points: [[0, 0], [20, 0], [20, 20], [0, 20]],
          corner: {
            all: { fillet: 5 },
          },
        },
        areaMarker: {
          type: "point",
          at: ["rounded.area", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const areaMarker = res.objects.areaMarker as ResolvedPoint;
    expect(areaMarker.x).toBeCloseTo(300 + 25 * Math.PI, 1);
  });

  it("should use sampled curve bounds for quadratic derived bbox anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        q1: {
          type: "quadratic",
          from: [0, 0],
          cp: [10, 100],
          to: [20, 0],
        },
        marker: {
          type: "point",
          at: ["q1.bottom", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeCloseTo(50, 0);
  });

  it("should use the curve envelope, not control points, for segmented path anchors", () => {
    const path = {
      id: "segmented",
      type: "path",
      closed: false,
      segments: [{
        type: "quadratic",
        x1: 0,
        y1: 0,
        cpx: 10,
        cpy: 100,
        x2: 20,
        y2: 0,
      }],
    };

    expect(getAnchorValue(path, "bottom")).toBeCloseTo(50, 1);
    expect(getAnchorValue(path, "centerY")).toBeCloseTo(25, 1);
  });

  it("should use sampled curve bounds in group bbox calculations", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        q1: {
          type: "quadratic",
          from: [0, 0],
          cp: [10, 100],
          to: [20, 0],
        },
        g1: {
          type: "group",
          children: ["q1"],
        },
        marker: {
          type: "point",
          at: ["g1.bottom", 0],
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeCloseTo(50, 0);
  });

  it("should apply object transform when calculating bounding boxes", () => {
    const bbox = calculateBoundingBox({
      q1: {
        id: "q1",
        type: "quadratic",
        x1: 0,
        y1: 0,
        cpx: 10,
        cpy: 100,
        x2: 20,
        y2: 0,
        transform: [{ type: "translate", x: 30, y: 40 }],
      },
    });

    expect(bbox.x).toBeCloseTo(30, 4);
    expect(bbox.y).toBeCloseTo(40, 4);
    expect(bbox.width).toBeCloseTo(20, 4);
    expect(bbox.height).toBeGreaterThan(45);
  });

  it("should use sampled arc bounds for custom anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        a1: {
          type: "arc",
          center: [0, 0],
          radius: 10,
          startAngle: Math.PI / 4,
          endAngle: (3 * Math.PI) / 4,
          anchors: {
            topMid: ["50%", "100%"],
          },
        } as any,
        marker: {
          type: "point",
          at: "a1.topMid",
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeCloseTo(0, 4);
    expect(marker.y).toBeCloseTo(10, 2);
  });

  it("should use sampled quadratic bounds for custom anchors", () => {
    const doc: RelGeoDocument = {
      version: 0.3,
      objects: {
        q1: {
          type: "quadratic",
          from: [0, 0],
          cp: [10, 100],
          to: [20, 0],
          anchors: {
            crest: ["50%", "100%"],
          },
        } as any,
        marker: {
          type: "point",
          at: "q1.crest",
        },
      },
    };

    const res = resolveGeometry(doc);
    const marker = res.objects.marker as ResolvedPoint;
    expect(marker.x).toBeCloseTo(10, 1);
    expect(marker.y).toBeLessThan(60);
    expect(marker.y).toBeGreaterThan(45);
  });
});
