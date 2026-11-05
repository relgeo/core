import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument } from "../types";
import { Validator } from "../validator";

const mockTextMetrics = {
  measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
  measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("v0.4: Repeat & Divide System (Phase B)", () => {
  it("divides closed shapes (circle) and open shapes (line) into points correctly", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myCircle: {
          type: "circle",
          center: [100, 100],
          radius: 50
        },
        myLine: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        },
        circleDiv: {
          type: "divide",
          target: "myCircle",
          count: 4
        } as any,
        lineDiv: {
          type: "divide",
          target: "myLine",
          count: 3
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });

    // Verify Circle division (closed shape: excludes endpoint duplicate)
    const circleDiv = scene.objects.circleDiv as any;
    expect(circleDiv.type).toBe("collection");
    expect(circleDiv.children).toHaveLength(4);
    
    const pt0 = scene.objects["circleDiv[0]"] as any;
    const pt1 = scene.objects["circleDiv[1]"] as any;
    const pt2 = scene.objects["circleDiv[2]"] as any;
    const pt3 = scene.objects["circleDiv[3]"] as any;

    expect(pt0.x).toBeCloseTo(150, 2);
    expect(pt0.y).toBeCloseTo(100, 2);
    expect(pt1.x).toBeCloseTo(100, 2);
    expect(pt1.y).toBeCloseTo(150, 2);
    expect(pt2.x).toBeCloseTo(50, 2);
    expect(pt2.y).toBeCloseTo(100, 2);
    expect(pt3.x).toBeCloseTo(100, 2);
    expect(pt3.y).toBeCloseTo(50, 2);

    // Verify Line division (open shape: includes endpoint)
    const lineDiv = scene.objects.lineDiv as any;
    expect(lineDiv.type).toBe("collection");
    expect(lineDiv.children).toHaveLength(3);

    const lpt0 = scene.objects["lineDiv[0]"] as any;
    const lpt1 = scene.objects["lineDiv[1]"] as any;
    const lpt2 = scene.objects["lineDiv[2]"] as any;

    expect(lpt0.x).toBeCloseTo(0, 2);
    expect(lpt1.x).toBeCloseTo(50, 2);
    expect(lpt2.x).toBeCloseTo(100, 2);
  });

  it("handles linear repeat with index-based expressions", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myRepeat: {
          type: "repeat",
          count: 3,
          item: {
            type: "circle",
            radius: 5,
            center: ["index * 20", 50]
          } as any
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const repeatObj = scene.objects.myRepeat as any;
    expect(repeatObj.type).toBe("collection");
    expect(repeatObj.children).toHaveLength(3);

    const c0 = scene.objects["myRepeat[0]"] as any;
    const c1 = scene.objects["myRepeat[1]"] as any;
    const c2 = scene.objects["myRepeat[2]"] as any;

    expect(c0.cx).toBe(0);
    expect(c1.cx).toBe(20);
    expect(c2.cx).toBe(40);
  });

  it("handles grid repeat with dynamic col/row indexing and automatic offsets", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myGrid: {
          type: "repeat",
          grid: {
            rows: 2,
            cols: 3,
            pitch: [15, 25]
          },
          item: {
            type: "circle",
            radius: 5
            // no center: automatic translate by col * gapX, row * gapY
          } as any
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const gridObj = scene.objects.myGrid as any;
    expect(gridObj.type).toBe("collection");
    expect(gridObj.children).toHaveLength(6);

    const c00 = scene.objects["myGrid[0,0]"] as any;
    const c01 = scene.objects["myGrid[0,1]"] as any;
    const c12 = scene.objects["myGrid[1,2]"] as any;

    expect(c00.cx).toBe(0);
    expect(c00.cy).toBe(0);

    expect(c01.cx).toBe(15);
    expect(c01.cy).toBe(0);

    expect(c12.cx).toBe(30);
    expect(c12.cy).toBe(25);
  });

  it("handles polar repeat around center with custom anchors and relative center binding", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myOrigin: {
          type: "point",
          at: [50, 50]
        },
        myPolar: {
          type: "repeat",
          polar: {
            count: 4,
            center: "myOrigin",
            radius: 10
          },
          item: {
            type: "circle",
            radius: 2
          } as any
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const polarObj = scene.objects.myPolar as any;
    expect(polarObj.type).toBe("collection");
    expect(polarObj.children).toHaveLength(4);

    const c0 = scene.objects["myPolar[0]"] as any;
    const c1 = scene.objects["myPolar[1]"] as any;

    expect(c0.cx).toBeCloseTo(60, 2);
    expect(c0.cy).toBeCloseTo(50, 2);

    expect(c1.cx).toBeCloseTo(50, 2);
    expect(c1.cy).toBeCloseTo(60, 2);
  });

  it("rejects non-positive or non-finite polar radius at resolve time", () => {
    const invalidRadius = {
      version: 0.5,
      objects: {
        center: { type: "point", at: [0, 0] },
        polar: {
          type: "repeat",
          polar: { count: 4, center: "center", radius: -1 },
          item: { type: "point", at: [0, 0] },
        },
      },
    } as any;

    expect(() => resolveGeometry(invalidRadius, { mode: "editor" })).toThrow(/polar radius must be a positive finite length/);
  });

  it("rejects fractional and non-finite divide counts without rounding or looping", () => {
    const fractionalCount = {
      version: 0.5,
      objects: {
        line: { type: "line", from: [0, 0], to: [10, 0] },
        pieces: { type: "divide", target: "line", count: 2.5 },
      },
    } as any;
    expect(() => resolveGeometry(fractionalCount, { mode: "editor" })).toThrow(/Invalid count in divide object/);

    const nonFiniteCount = {
      version: 0.5,
      objects: {
        line: { type: "line", from: [0, 0], to: [10, 0] },
        pieces: { type: "divide", target: "line", count: Number.POSITIVE_INFINITY },
      },
    } as any;
    expect(() => resolveGeometry(nonFiniteCount, { mode: "editor" })).toThrow(/Invalid count in divide object/);
  });

  it("handles each repeat over explicit coordinates and divide collections", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myLine: {
          type: "line",
          from: [10, 10],
          to: [50, 10]
        },
        marks: {
          type: "divide",
          target: "myLine",
          count: 3
        } as any,
        dots: {
          type: "repeat",
          each: "marks",
          item: {
            type: "circle",
            radius: 2
          } as any
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const dotsObj = scene.objects.dots as any;
    expect(dotsObj.type).toBe("collection");
    expect(dotsObj.children).toHaveLength(3);

    const d0 = scene.objects["dots[0]"] as any;
    const d1 = scene.objects["dots[1]"] as any;
    const d2 = scene.objects["dots[2]"] as any;

    expect(d0.cx).toBeCloseTo(10, 2);
    expect(d1.cx).toBeCloseTo(30, 2);
    expect(d2.cx).toBeCloseTo(50, 2);
  });

  it("integrates repeat collections as closed holes subtractively inside a path", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        boltPattern: {
          type: "repeat",
          grid: {
            rows: 2,
            cols: 2,
            pitch: [40, 40]
          },
          place: {
            topLeft: [25, 25]
          },
          item: {
            type: "circle",
            radius: 5
          } as any
        } as any,
        mainPlate: {
          type: "path",
          points: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0]
          ],
          closed: true,
          holes: ["boltPattern"]
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const plate = scene.objects.mainPlate as any;
    
    // Plate should successfully subtract the 4 bolt holes
    expect(plate.holes).toHaveLength(4);
    expect(plate.holes[0].segments.length).toBeGreaterThan(0);

    // Compute bounding box / center of first hole
    const h0_x = plate.holes[0].segments.map((s: any) => s.x1);
    const h0_y = plate.holes[0].segments.map((s: any) => s.y1);
    expect((Math.min(...h0_x) + Math.max(...h0_x)) / 2).toBeCloseTo(30, 1);
    expect((Math.min(...h0_y) + Math.max(...h0_y)) / 2).toBeCloseTo(30, 1);

    // Compute bounding box / center of fourth hole
    const h3_x = plate.holes[3].segments.map((s: any) => s.x1);
    const h3_y = plate.holes[3].segments.map((s: any) => s.y1);
    expect((Math.min(...h3_x) + Math.max(...h3_x)) / 2).toBeCloseTo(70, 1);
    expect((Math.min(...h3_y) + Math.max(...h3_y)) / 2).toBeCloseTo(70, 1);
  });

  it("evaluates linear collection bracket indexing correctly", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        holes: {
          type: "repeat",
          count: 3,
          item: {
            type: "circle",
            radius: 5,
            center: ["index * 20", 50]
          } as any
        } as any,
        secondHoleRadius: {
          type: "point",
          at: ["holes[1].radius", 10]
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const p = scene.objects.secondHoleRadius as any;
    expect(p.x).toBe(5);
  });

  it("evaluates grid collection bracket indexing correctly", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        vents: {
          type: "repeat",
          grid: {
            rows: 2,
            cols: 3,
            gap: [15, 25]
          },
          item: {
            type: "circle",
            radius: "(row + col) * 10"
          } as any
        } as any,
        targetVentRadius: {
          type: "point",
          at: ["vents[1, 2].radius", 10]
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const p = scene.objects.targetVentRadius as any;
    expect(p.x).toBe(30);
  });

  it("throws INVALID_COLLECTION_ACCESS when index is out of bounds", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        holes: {
          type: "repeat",
          count: 2,
          item: {
            type: "circle",
            radius: 5,
            center: [0, 0]
          } as any
        } as any,
        outOfBoundsPoint: {
          type: "point",
          at: ["holes[5].radius", 10]
        } as any
      }
    };

    expect(() => resolveGeometry(doc, { textMetrics: mockTextMetrics })).toThrow("INVALID_COLLECTION_ACCESS");
  });

  it("throws INVALID_REPEAT_COUNT for invalid repeat counts dynamically", () => {
    const docGrid: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        badGrid: {
          type: "repeat",
          grid: {
            rows: -1,
            cols: 3,
            gap: 10
          },
          item: {
            type: "circle",
            radius: 5
          } as any
        } as any
      }
    };
    expect(() => resolveGeometry(docGrid, { textMetrics: mockTextMetrics })).toThrow("INVALID_REPEAT_COUNT");

    const docLinear: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        badLinear: {
          type: "repeat",
          count: 2.5,
          item: {
            type: "circle",
            radius: 5
          } as any
        } as any
      }
    };
    expect(() => resolveGeometry(docLinear, { textMetrics: mockTextMetrics })).toThrow("INVALID_REPEAT_COUNT");
  });

  it("validates invalid repeat counts statically via validator", () => {
    const badDoc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        myRep: {
          type: "repeat",
          count: 0,
          item: {
            type: "circle",
            radius: 5
          }
        } as any
      }
    };
    const validator = new Validator(badDoc);
    expect(() => validator.validate()).toThrow("INVALID_REPEAT_COUNT");
  });

  it("evaluates count(), first(), and last() on repeat collections correctly", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        holes: {
          type: "repeat",
          count: 3,
          item: {
            type: "circle",
            radius: "(index + 1) * 5",
            center: ["index * 30", 50]
          } as any
        } as any,
        totalHoles: {
          type: "point",
          at: ["count(holes)", 10]
        } as any,
        firstHoleRadius: {
          type: "point",
          at: ["first(holes).radius", 20]
        } as any,
        lastHoleRadius: {
          type: "point",
          at: ["last(holes).radius", 30]
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const total = scene.objects.totalHoles as any;
    const firstRad = scene.objects.firstHoleRadius as any;
    const lastRad = scene.objects.lastHoleRadius as any;

    expect(total.x).toBe(3);
    expect(firstRad.x).toBe(5);
    expect(lastRad.x).toBe(15);
  });

  it("throws INVALID_COLLECTION_ACCESS when first() or last() is called on an empty collection/array", () => {
    const docEmpty: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        holes: {
          type: "repeat",
          each: [],
          item: {
            type: "circle",
            radius: 5
          } as any
        } as any,
        badPoint: {
          type: "point",
          at: ["first(holes).radius", 10]
        } as any
      }
    };

    expect(() => resolveGeometry(docEmpty, { textMetrics: mockTextMetrics })).toThrow("INVALID_COLLECTION_ACCESS");
  });

  it("validates count(), first(), and last() statically via validator", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      objects: {
        holes: {
          type: "repeat",
          count: 3,
          item: {
            type: "circle",
            radius: 5,
            center: [0, 0]
          } as any
        } as any,
        valCount: {
          type: "point",
          at: ["count(holes)", 10]
        } as any,
        valFirst: {
          type: "point",
          at: ["first(holes).radius", 20]
        } as any,
        valLast: {
          type: "point",
          at: ["last(holes).radius", 30]
        } as any
      }
    };
    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();
  });

  it("resolves repeat.along with uniform-length on an open path", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      objects: {
        guide: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        marks: {
          type: "repeat",
          along: {
            target: "guide",
            count: 3,
            spacing: "uniform-length"
          },
          item: {
            type: "point",
            at: "item.point"
          } as any
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const marks = scene.objects.marks as any;
    expect(marks.type).toBe("collection");
    expect(marks.children).toHaveLength(3);
    expect((scene.objects["marks[0]"] as any).x).toBeCloseTo(0, 2);
    expect((scene.objects["marks[1]"] as any).x).toBeCloseTo(50, 2);
    expect((scene.objects["marks[2]"] as any).x).toBeCloseTo(100, 2);
  });

  it("resolves repeat.along fixed-distance by deriving count from usable length", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      objects: {
        guide: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        pegs: {
          type: "repeat",
          along: {
            target: "guide",
            spacing: "fixed-distance",
            distance: 30
          },
          item: {
            type: "point",
            at: ["item.distance", "item.t * 100"]
          } as any
        } as any
      }
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const pegs = scene.objects.pegs as any;
    expect(pegs.type).toBe("collection");
    expect(pegs.children).toHaveLength(4);
    expect((scene.objects["pegs[0]"] as any).x).toBeCloseTo(0, 2);
    expect((scene.objects["pegs[1]"] as any).x).toBeCloseTo(30, 2);
    expect((scene.objects["pegs[2]"] as any).x).toBeCloseTo(60, 2);
    expect((scene.objects["pegs[3]"] as any).x).toBeCloseTo(90, 2);
    expect((scene.objects["pegs[3]"] as any).y).toBeCloseTo(90, 1);
  });

  it("does not duplicate the start point for uniform-t on a closed path", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      objects: {
        frame: {
          type: "polygon",
          points: [[0, 0], [100, 0], [100, 100], [0, 100]],
        } as any,
        marks: {
          type: "repeat",
          along: {
            target: "frame",
            count: 4,
            spacing: "uniform-t",
          },
          item: {
            type: "point",
            at: "item.point",
          } as any,
        } as any,
      },
    };

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const points = [0, 1, 2, 3].map((index) => scene.objects[`marks[${index}]`] as any);
    expect(points.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(points[3]).not.toEqual(points[0]);
  });

  it("rejects repeat.along fixed-distance when count is explicitly provided", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      objects: {
        guide: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        } as any,
        badRepeat: {
          type: "repeat",
          along: {
            target: "guide",
            spacing: "fixed-distance",
            distance: 20,
            count: 5
          },
          item: {
            type: "point",
            at: [0, 0]
          } as any
        } as any
      }
    };

    const validator = new Validator(doc);
    expect(() => validator.validate()).toThrow("INVALID_REPEAT_ALONG_SPACING");
  });

  it("rejects negative along offsets at resolve time", () => {
    const doc = {
      version: 0.5,
      objects: {
        guide: {
          type: "line",
          from: [0, 0],
          to: [100, 0]
        },
        badRepeat: {
          type: "repeat",
          along: {
            target: "guide",
            spacing: "uniform-length",
            count: 3,
            startOffset: -1
          },
          item: {
            type: "point",
            at: "item.point"
          }
        }
      }
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor", textMetrics: mockTextMetrics }))
      .toThrow(/repeat\.along offsets must be finite and non-negative/);
  });
});
