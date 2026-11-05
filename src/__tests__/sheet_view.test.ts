import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument } from "../types";

describe("Sheet & View Composition System", () => {
  describe("View Resolution & Filtering", () => {
    it("should resolve view with scale and collect targeted shapes", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          rect1: {
            type: "rect",
            size: [100, 50],
            place: { left: 0, top: 0 }
          }
        },
        views: {
          frontView: {
            target: "rect1",
            scale: "1:2"
          }
        }
      };

      const res = resolveGeometry(doc);
      expect(res.views).toBeDefined();
      const view = res.views!.frontView;
      expect(view).toBeDefined();
      expect(view.id).toBe("frontView");
      expect(view.target).toBe("rect1");
      expect(view.scale).toBe("1:2");
      expect(view.scaleFactor).toBe(0.5);
      expect(view.objects.rect1).toBeDefined();

      // Bounding box of original rect is x:0, y:0, w:100, h:50
      // Scaled by 0.5 -> x:0, y:0, w:50, h:25
      expect(view.bbox.x).toBe(0);
      expect(view.bbox.y).toBe(0);
      expect(view.bbox.width).toBe(50);
      expect(view.bbox.height).toBe(25);
    });

    it("should apply role filtering to views", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          line1: {
            type: "line",
            from: [0, 0],
            to: [100, 0],
            meta: { role: "construction" }
          },
          line2: {
            type: "line",
            from: [0, 10],
            to: [100, 10],
            meta: { role: "guide" }
          }
        },
        views: {
          filteredView: {
            target: "line1",
            filter: {
              roles: ["construction", "final"]
            }
          }
        }
      };

      const res = resolveGeometry(doc);
      const view = res.views!.filteredView;
      expect(view.objects.line1).toBeDefined();
      expect(view.objects.line2).toBeUndefined(); // Filtered out because role is 'guide'
    });

    it("should carry document and view metadata into resolved output", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        meta: {
          title: "Rear Panel",
          author: "Agus",
        },
        objects: {
          rect1: {
            type: "rect",
            size: [100, 50],
            place: { left: 0, top: 0 }
          }
        },
        views: {
          frontView: {
            target: "rect1",
            meta: {
              title: "Front Detail",
            }
          }
        }
      };

      const res = resolveGeometry(doc);
      expect(res.meta).toMatchObject({ title: "Rear Panel", author: "Agus" });
      expect(res.views!.frontView.meta).toMatchObject({ title: "Front Detail" });
    });
  });

  describe("Sheet Sizing & Placement Layout", () => {
    it("should calculate standard A4 sheet in portrait and landscape", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "mm" },
        objects: {
          pt1: { type: "point", at: [0, 0] }
        },
        sheets: {
          sheet1: {
            size: "A4",
            orientation: "landscape"
          },
          sheet2: {
            size: "A4",
            orientation: "portrait"
          }
        }
      };

      const res = resolveGeometry(doc);
      expect(res.sheets).toBeDefined();
      const s1 = res.sheets!.sheet1;
      const s2 = res.sheets!.sheet2;

      // Landscape A4 = 297 x 210
      expect(s1.width).toBe(297);
      expect(s1.height).toBe(210);

      // Portrait A4 = 210 x 297
      expect(s2.width).toBe(210);
      expect(s2.height).toBe(297);
    });

    it("should reject unknown string sheet size instead of silently falling back to A4", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "mm" },
        objects: {
          pt1: { type: "point", at: [0, 0] }
        },
        sheets: {
          badSheet: {
            size: "A5" as any,
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/size "A5" is invalid/);
    });

    it("should calculate custom size with length expressions", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        scene: { unit: "mm" },
        parameters: {
          sheetW: "500mm",
          sheetH: "400mm"
        },
        objects: {
          pt1: { type: "point", at: [0, 0] }
        },
        sheets: {
          customSheet: {
            size: ["sheetW", "sheetH"]
          }
        }
      };

      const res = resolveGeometry(doc);
      const sheet = res.sheets!.customSheet;
      expect(sheet.width).toBeCloseTo(500);
      expect(sheet.height).toBeCloseTo(400);
    });

    it("should position views on sheet using topLeft and center placements", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          rect1: {
            type: "rect",
            size: [100, 100],
            place: { left: 0, top: 0 }
          }
        },
        views: {
          viewA: {
            target: "rect1",
            scale: "1:2" // w:50, h:50
          }
        },
        sheets: {
          drawingSheet: {
            size: "A3", // 420 x 297
            views: [
              {
                use: "viewA",
                place: {
                  topLeft: [50, 50]
                }
              },
              {
                use: "viewA",
                place: {
                  center: [200, 200]
                }
              }
            ]
          }
        }
      };

      const res = resolveGeometry(doc);
      const sheet = res.sheets!.drawingSheet;
      expect(sheet.views.length).toBe(2);

      // 1. topLeft placement at [50, 50]
      const placement1 = sheet.views[0];
      expect(placement1.x).toBe(50);
      expect(placement1.y).toBe(50);
      expect(placement1.width).toBe(50);
      expect(placement1.height).toBe(50);

      // 2. center placement at [200, 200]
      // center x: 200 - 50/2 = 175
      // center y: 200 - 50/2 = 175
      const placement2 = sheet.views[1];
      expect(placement2.x).toBe(175);
      expect(placement2.y).toBe(175);
      expect(placement2.width).toBe(50);
      expect(placement2.height).toBe(50);
    });

    it("should carry sheet metadata into resolved output", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          rect1: {
            type: "rect",
            size: [100, 100],
            place: { left: 0, top: 0 }
          }
        },
        sheets: {
          drawingSheet: {
            size: "A4",
            meta: {
              title: "Assembly Sheet",
              author: "Agus",
            }
          }
        }
      };

      const res = resolveGeometry(doc);
      expect(res.sheets!.drawingSheet.meta).toMatchObject({
        title: "Assembly Sheet",
        author: "Agus",
      });
    });

    it("should include cloned geometry when a view targets a clone", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          base: {
            type: "rect",
            size: [100, 50],
            place: { left: 0, top: 0 }
          },
          shifted: {
            type: "clone",
            of: "base",
            transform: [
              { translate: [200, 0] }
            ]
          }
        },
        views: {
          cloneView: {
            target: "shifted",
          }
        }
      };

      const res = resolveGeometry(doc);
      const view = res.views!.cloneView;
      expect(view.objects.shifted).toBeDefined();
      expect(view.objects.base).toBeDefined();
      expect(view.bbox.x).toBe(200);
      expect(view.bbox.y).toBe(0);
      expect(view.bbox.width).toBe(100);
      expect(view.bbox.height).toBe(50);
    });

    it("should use a custom clone anchor as a placement target", () => {
      const scene = resolveGeometry({
        version: 0.5,
        objects: {
          base: { type: "rect", size: [10, 10], place: { topLeft: [0, 0] } },
          shifted: {
            type: "clone",
            of: "base",
            anchors: { hook: ["50%", "50%"] },
            place: { hook: [100, 100] },
          },
        },
      } as any);

      const clone = scene.objects.shifted as any;
      expect(clone.anchors.hook).toEqual({ x: 5, y: 5 });
      expect(clone.transform).toEqual([{ type: "translate", x: 95, y: 95 }]);
    });
  });

  describe("Semantic Validation Rules", () => {
    it("should throw error if view target reference is unknown", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          pt1: { type: "point", at: [0, 0] }
        },
        views: {
          badView: {
            target: "NonExistent"
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/UNKNOWN_REFERENCE/);
    });

    it("should throw error if sheet placement use reference is unknown", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          pt1: { type: "point", at: [0, 0] }
        },
        sheets: {
          badSheet: {
            size: "A4",
            views: [
              {
                use: "NonExistentView"
              }
            ]
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/UNKNOWN_REFERENCE/);
    });

    it("should throw error if sheet placement mixes topLeft and center anchors", () => {
      const doc: RelGeoDocument = {
        version: 0.4,
        objects: {
          rect1: {
            type: "rect",
            size: [100, 100],
            place: { left: 0, top: 0 }
          }
        },
        views: {
          viewA: {
            target: "rect1"
          }
        },
        sheets: {
          badSheet: {
            size: "A4",
            views: [
              {
                use: "viewA",
                place: {
                  topLeft: [10, 10],
                  center: [20, 20]
                }
              }
            ]
          }
        }
      };

      expect(() => resolveGeometry(doc)).toThrow(/only one of topLeft or center/);
    });
  });
});
