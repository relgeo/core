import { describe, it, expect } from "vitest";
import { RelGeoDocument } from "../types";
import { Validator } from "../validator";
import { resolveGeometry } from "../resolver";
import { getAnchorValue } from "../resolver/anchors";
import { parseRelGeo } from "../parser";

describe("Path Holes Integration", () => {
    it("should validate that path with holes must be closed", () => {
        const doc: RelGeoDocument = {
            version: "0.3",
            objects: {
                p1: {
                    type: "path",
                    closed: false,
                    segments: [{ line: { from: [0, 0], to: [100, 100] } }],
                    holes: [{ segments: [{ line: { from: [10, 10], to: [20, 20] } }] }]
                }
            }
        };
        const validator = new Validator(doc, "validate");
        expect(() => validator.validate()).toThrow("must be \"closed: true\"");
    });

    it("should resolve a path with holes and calculate the correct area", () => {
        const doc: RelGeoDocument = {
            version: "0.3",
            objects: {
                square: {
                    type: "path",
                    closed: true,
                    segments: [
                        { line: { from: [0, 0], to: [100, 0] } },
                        { line: { to: [100, 100] } },
                        { line: { to: [0, 100] } },
                        { line: { to: [0, 0] } }
                    ],
                    holes: [
                        {
                            segments: [
                                { line: { from: [40, 40], to: [60, 40] } },
                                { line: { to: [60, 60] } },
                                { line: { to: [40, 60] } },
                                { line: { to: [40, 40] } }
                            ]
                        }
                    ]
                }
            }
        };
        const scene = resolveGeometry(doc);
        const square = scene.objects.square as any;

        // Area of outer 100x100 = 10000
        // Area of hole 20x20 = 400
        // Total should be 9600
        const area = getAnchorValue(square, "area", scene as any);
        expect(area).toBe(9600);
        
        // Check if holes are resolved and translated
        expect(square.holes).toBeDefined();
        expect(square.holes.length).toBe(1);
        expect(square.holes[0].segments.length).toBe(4);
    });

    it("should detect intersections with holes", () => {
        const doc: RelGeoDocument = {
            version: "0.3",
            objects: {
                square: {
                    type: "path",
                    closed: true,
                    segments: [
                        { line: { from: [0, 0], to: [100, 0] } },
                        { line: { to: [100, 100] } },
                        { line: { to: [0, 100] } },
                        { line: { to: [0, 0] } }
                    ],
                    holes: [
                        {
                            segments: [
                                { line: { from: [40, 40], to: [60, 40] } },
                                { line: { to: [60, 60] } },
                                { line: { to: [40, 60] } },
                                { line: { to: [40, 40] } }
                            ]
                        }
                    ]
                },
                cutter: {
                    type: "line",
                    from: [50, -10],
                    to: [50, 110]
                },
                i1: { type: "point", on: { path: { path: "cutter", t: 0 } }, at: "intersection(square, cutter, first)" },
                i2: { type: "point", on: { path: { path: "cutter", t: 0 } }, at: "intersection(square, cutter, {index: 1})" },
                i3: { type: "point", on: { path: { path: "cutter", t: 0 } }, at: "intersection(square, cutter, {index: 2})" },
                i4: { type: "point", on: { path: { path: "cutter", t: 0 } }, at: "intersection(square, cutter, last)" }
            }
        };
        const scene = resolveGeometry(doc);

        // Line at x=50, from y=-10 to 110
        // Intersects outer at y=0 and y=100
        // Intersects hole at y=40 and y=60
        // Sorted y: 0, 40, 60, 100
        
        expect((scene.objects.i1 as any).y).toBe(0);
        expect((scene.objects.i2 as any).y).toBe(40);
        expect((scene.objects.i3 as any).y).toBe(60);
        expect((scene.objects.i4 as any).y).toBe(100);
    });

    describe("Strict topology validation", () => {
        it("should throw if a hole is completely outside the path", () => {
            const doc: RelGeoDocument = {
                version: "0.3",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [50, 0] } },
                            { line: { to: [50, 50] } },
                            { line: { to: [0, 50] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [100, 100], to: [120, 100] } },
                                    { line: { to: [120, 120] } },
                                    { line: { to: [100, 120] } },
                                    { line: { to: [100, 100] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrow("HOLE_OUTSIDE_BOUNDARY");
        });

        it("should throw if a hole is partially outside the path", () => {
            const doc: RelGeoDocument = {
                version: "0.3",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [50, 0] } },
                            { line: { to: [50, 50] } },
                            { line: { to: [0, 50] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [40, 40], to: [60, 40] } },
                                    { line: { to: [60, 60] } },
                                    { line: { to: [40, 60] } },
                                    { line: { to: [40, 40] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrow("HOLE_OUTSIDE_BOUNDARY");
        });

        it("should throw if two holes overlap", () => {
            const doc: RelGeoDocument = {
                version: "0.3",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [100, 0] } },
                            { line: { to: [100, 100] } },
                            { line: { to: [0, 100] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [10, 10], to: [50, 10] } },
                                    { line: { to: [50, 50] } },
                                    { line: { to: [10, 50] } },
                                    { line: { to: [10, 10] } }
                                ]
                            },
                            {
                                segments: [
                                    { line: { from: [40, 40], to: [80, 40] } },
                                    { line: { to: [80, 80] } },
                                    { line: { to: [40, 80] } },
                                    { line: { to: [40, 40] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrow("HOLE_OVERLAP");
        });

        it("should throw if two holes are nested", () => {
            const doc: RelGeoDocument = {
                version: "0.3",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [100, 0] } },
                            { line: { to: [100, 100] } },
                            { line: { to: [0, 100] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [10, 10], to: [90, 10] } },
                                    { line: { to: [90, 90] } },
                                    { line: { to: [10, 90] } },
                                    { line: { to: [10, 10] } }
                                ]
                            },
                            {
                                segments: [
                                    { line: { from: [30, 30], to: [70, 30] } },
                                    { line: { to: [70, 70] } },
                                    { line: { to: [30, 70] } },
                                    { line: { to: [30, 30] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrow("HOLE_OVERLAP");
        });
    });

    describe("Single-key Polymorphic Hole Normalization", () => {
        it("should parse and normalize a circle single-key dictionary hole", () => {
            const yaml = `
version: "0.4"
objects:
  square:
    type: path
    closed: true
    segments:
      - line: { from: [0, 0], to: [100, 0] }
      - line: { to: [100, 100] }
      - line: { to: [0, 100] }
      - line: { to: [0, 0] }
    holes:
      - circle:
          center: [50, 50]
          radius: 10
`;
            const doc = parseRelGeo(yaml);
            const squareDocObj = doc.objects.square as any;
            expect(squareDocObj.holes).toBeDefined();
            expect(squareDocObj.holes[0]).toEqual({
                type: "circle",
                center: [50, 50],
                radius: 10
            });

            // Ensure resolveGeometry works perfectly
            const scene = resolveGeometry(doc);
            const squareObj = scene.objects.square as any;
            expect(squareObj.holes).toBeDefined();
            expect(squareObj.holes.length).toBe(1);
        });

        it("should parse and normalize a segments list single-key dictionary hole", () => {
            const yaml = `
version: "0.4"
objects:
  square:
    type: path
    closed: true
    segments:
      - line: { from: [0, 0], to: [100, 0] }
      - line: { to: [100, 100] }
      - line: { to: [0, 100] }
      - line: { to: [0, 0] }
    holes:
      - segments:
          - line: { from: [40, 40], to: [60, 40] }
          - line: { to: [60, 60] }
          - line: { to: [40, 60] }
          - line: { to: [40, 40] }
`;
            const doc = parseRelGeo(yaml);
            const squareDocObj = doc.objects.square as any;
            expect(squareDocObj.holes).toBeDefined();
            expect(squareDocObj.holes[0].segments).toBeDefined();
            expect(squareDocObj.holes[0].segments.length).toBe(4);

            // Ensure resolveGeometry works perfectly
            const scene = resolveGeometry(doc);
            const squareObj = scene.objects.square as any;
            expect(squareObj.holes).toBeDefined();
            expect(squareObj.holes.length).toBe(1);
            expect(squareObj.holes[0].segments.length).toBe(4);
        });

        it("should parse, normalize and resolve clone holes (both inline and referenced)", () => {
            const yaml = `
version: "0.4"
objects:
  lingkaran1:
    type: circle
    center: [0, 0]
    radius: 10
  clonedTopLevel:
    type: clone
    of: lingkaran1
    place:
      center: [30, 30]
  square:
    type: path
    closed: true
    segments:
      - line: { from: [0, 0], to: [100, 0] }
      - line: { to: [100, 100] }
      - line: { to: [0, 100] }
      - line: { to: [0, 0] }
    holes:
      # A. String reference ke top-level cloned object
      - "clonedTopLevel"
      # B. Inline clone
      - clone:
          of: lingkaran1
          place:
            center: [70, 70]
`;
            const doc = parseRelGeo(yaml);
            
            // Check parser normalization
            const squareDocObj = doc.objects.square as any;
            expect(squareDocObj.holes).toBeDefined();
            expect(squareDocObj.holes[0]).toBe("clonedTopLevel");
            expect(squareDocObj.holes[1]).toEqual({
                type: "clone",
                of: "lingkaran1",
                place: {
                    center: [70, 70]
                }
            });

            // Ensure resolveGeometry works perfectly
            const scene = resolveGeometry(doc);
            const squareObj = scene.objects.square as any;
            expect(squareObj.holes).toBeDefined();
            expect(squareObj.holes.length).toBe(2);

            // First hole should be at [30, 30]
            const h1 = squareObj.holes[0];
            expect(h1.segments.length).toBe(64);
            const xcoords1 = h1.segments.map((s: any) => s.x1);
            const ycoords1 = h1.segments.map((s: any) => s.y1);
            const cx1 = (Math.min(...xcoords1) + Math.max(...xcoords1)) / 2;
            const cy1 = (Math.min(...ycoords1) + Math.max(...ycoords1)) / 2;
            expect(cx1).toBeCloseTo(30, 2);
            expect(cy1).toBeCloseTo(30, 2);

            // Second hole should be at [70, 70]
            const h2 = squareObj.holes[1];
            expect(h2.segments.length).toBe(64);
            const xcoords2 = h2.segments.map((s: any) => s.x1);
            const ycoords2 = h2.segments.map((s: any) => s.y1);
            const cx2 = (Math.min(...xcoords2) + Math.max(...xcoords2)) / 2;
            const cy2 = (Math.min(...ycoords2) + Math.max(...ycoords2)) / 2;
            expect(cx2).toBeCloseTo(70, 2);
            expect(cy2).toBeCloseTo(70, 2);
        });
    });

    describe("Non-Path ClosedShape Holes Parity", () => {
        it("should parse, validate, and resolve rect with a circle hole", () => {
            const yaml = `
version: "0.4"
objects:
  panel:
    type: rect
    size: [100, 100]
    holes:
      - circle:
          center: [50, 50]
          radius: 10
`;
            const doc = parseRelGeo(yaml);
            const panelDocObj = doc.objects.panel as any;
            expect(panelDocObj.holes).toBeDefined();
            expect(panelDocObj.holes.length).toBe(1);
            expect(panelDocObj.holes[0].type).toBe("circle");
            expect(panelDocObj.holes[0].radius).toBe(10);

            const scene = resolveGeometry(doc);
            const panelObj = scene.objects.panel as any;
            expect(panelObj.holes).toBeDefined();
            expect(panelObj.holes.length).toBe(1);
            expect(panelObj.holes[0].segments.length).toBe(64);

            // Area check: 10000 - sampled circle area (~313.65)
            const area = getAnchorValue(panelObj, "area", scene as any);
            expect(area).toBeCloseTo(9686.3, 1);
        });

        it("should resolve inline hole geometry that references the parent object anchors", () => {
            const yaml = `
version: 0.5
scene:
  unit: mm
  padding: 0
objects:
  panel:
    type: rect
    size: [80, 40]
    place:
      topLeft: [0, 0]
    holes:
      - circle:
          center: panel.center
          radius: 10mm
    meta:
      fill: "#e2e8f0"
      stroke: "#64748b"
`;
            const scene = resolveGeometry(parseRelGeo(yaml));
            const panelObj = scene.objects.panel as any;
            expect(panelObj.holes).toBeDefined();
            expect(panelObj.holes).toHaveLength(1);

            const holePoints = panelObj.holes[0].segments.map((segment: any) => ({ x: segment.x1, y: segment.y1 }));
            const xs = holePoints.map((point: any) => point.x);
            const ys = holePoints.map((point: any) => point.y);
            const holeCenterX = (Math.min(...xs) + Math.max(...xs)) / 2;
            const holeCenterY = (Math.min(...ys) + Math.max(...ys)) / 2;

            expect(holeCenterX).toBeCloseTo(40, 3);
            expect(holeCenterY).toBeCloseTo(20, 3);
        });

        it("should parse, validate, and resolve circle with a rect hole", () => {
            const yaml = `
version: "0.4"
objects:
  ring:
    type: circle
    center: [50, 50]
    radius: 50
    holes:
      - rect:
          size: [20, 20]
          place:
            center: [50, 50]
`;
            const doc = parseRelGeo(yaml);
            const ringDocObj = doc.objects.ring as any;
            expect(ringDocObj.holes).toBeDefined();
            expect(ringDocObj.holes.length).toBe(1);

            const scene = resolveGeometry(doc);
            const ringObj = scene.objects.ring as any;
            expect(ringObj.holes).toBeDefined();
            expect(ringObj.holes.length).toBe(1);
            expect(ringObj.holes[0].segments.length).toBe(4);

            // Area check: exact circle area (~7853.98) - 400
            const area = getAnchorValue(ringObj, "area", scene as any);
            expect(area).toBeCloseTo(7453.98, 1);
        });

        it("should parse, validate, and resolve polygon with a circle hole", () => {
            const yaml = `
version: "0.4"
objects:
  poly:
    type: polygon
    points:
      - [0, 0]
      - [100, 0]
      - [100, 100]
      - [0, 100]
    holes:
      - circle:
          center: [50, 50]
          radius: 10
`;
            const doc = parseRelGeo(yaml);
            const polyDocObj = doc.objects.poly as any;
            expect(polyDocObj.holes).toBeDefined();

            const scene = resolveGeometry(doc);
            const polyObj = scene.objects.poly as any;
            expect(polyObj.holes).toBeDefined();
            expect(polyObj.holes.length).toBe(1);
            expect(polyObj.holes[0].segments.length).toBe(64);

            // Area check: 10000 - sampled circle area (~313.65)
            const area = getAnchorValue(polyObj, "area", scene as any);
            expect(area).toBeCloseTo(9686.3, 1);
        });

        it("should preserve chained curve segments in an inline hole", () => {
            const scene = resolveGeometry({
                version: 0.5,
                objects: {
                    panel: {
                        type: "polygon",
                        points: [[0, 0], [30, 0], [30, 30], [0, 30]],
                        holes: [{
                            segments: [
                                { quadratic: { from: [5, 5], cp: [10, 12], to: [15, 5] } },
                                { line: { to: [15, 15] } },
                                { cubic: { cp1: [12, 20], cp2: [8, 20], to: [5, 15] } },
                                { line: { to: [5, 5] } },
                            ],
                        }],
                    },
                },
            } as any);

            const hole = (scene.objects.panel as any).holes[0];
            expect(hole.segments.map((segment: any) => segment.type)).toEqual([
                "quadratic", "line", "cubic", "line",
            ]);
            for (let index = 1; index < hole.segments.length; index++) {
                expect(hole.segments[index].x1).toBe(hole.segments[index - 1].x2);
                expect(hole.segments[index].y1).toBe(hole.segments[index - 1].y2);
            }
            expect(hole.segments.at(-1)).toMatchObject({ x2: 5, y2: 5 });
        });
    });
});
