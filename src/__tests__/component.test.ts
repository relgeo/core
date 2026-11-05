import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { Validator } from "../validator";
import type { RelGeoDocument } from "../types";

const mockTextMetrics = {
  measureText: (text: string) => ({ width: text.length * 10, height: 12 }),
  measure: (input: any) => ({ width: (input.content || "").length * 10, height: 12, ascent: 9, descent: 3 })
};

describe("v0.4: Reusable Component System (Phase C)", () => {
  it("resolves dependent component defaults in local parameter order", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "px" },
      components: {
        dependentPanel: {
          parameters: {
            // Deliberately declared after the parameters that consume it.
            height: { type: "number", default: 25 },
            width: { type: "number", default: 20 },
            base: { type: "number", default: 10 },
          },
          objects: {
            panel: {
              type: "rect",
              size: ["width", "height"],
            } as any,
          },
        },
      },
      objects: {
        instance: {
          type: "component",
          use: "dependentPanel",
          // Deliberately supplied in reverse dependency order.
          params: { height: "width + 5", width: "base * 2", base: 12 },
        } as any,
      },
    };

    const scene = resolveGeometry(doc);
    expect(scene.objects["instance.panel"]).toMatchObject({
      type: "rect",
      width: 24,
      height: 29,
    });
  });

  it("resolves basic component instances with default and overridden parameters", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      components: {
        myHinge: {
          parameters: {
            size: 20,
            thickness: { default: 5, type: "number" }
          },
          objects: {
            body: {
              type: "rect",
              size: ["size", "thickness"]
            } as any
          }
        }
      },
      objects: {
        // Deliberately collide with the component-local object name. Each
        // instance must retain its prefixed namespace.
        body: {
          type: "rect",
          size: [2, 2],
        } as any,
        hinge1: {
          type: "component",
          use: "myHinge",
          params: {
            size: 40
          }
        } as any,
        hinge2: {
          type: "component",
          use: "myHinge",
          params: {
            size: 50,
            thickness: 10
          }
        } as any
      }
    };

    // Verify AST validation succeeds
    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    
    // Check that nested body elements were resolved with proper prefixed IDs and params
    expect((scene.objects.body as any).width).toBe(2);
    const resolvedBody1 = scene.objects["hinge1.body"] as any;
    expect(resolvedBody1).toBeDefined();
    expect(resolvedBody1.width).toBe(40);
    expect(resolvedBody1.height).toBe(5);

    const resolvedBody2 = scene.objects["hinge2.body"] as any;
    expect(resolvedBody2).toBeDefined();
    expect(resolvedBody2.width).toBe(50);
    expect(resolvedBody2.height).toBe(10);
  });

  it("handles exports correctly, blocking access to non-exported members while allowing public exports", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      components: {
        hinge: {
          parameters: {
            w: 10
          },
          exports: {
            top: "body.top",
            width: "body.width"
          },
          objects: {
            body: {
              type: "rect",
              size: ["w", 20]
            } as any
          }
        }
      },
      derived: {
        doubledWidth: "h1.width * 2",
      },
      objects: {
        h1: {
          type: "component",
          use: "hinge",
          params: {
            w: 30
          }
        } as any,
        // Valid references to exported public fields
        topPt: {
          type: "point",
          at: "h1.top"
        } as any,
        outerWidth: {
          type: "point",
          at: ["h1.width", 0]
        } as any
      }
    };

    // Verify AST validation succeeds
    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    
    // h1.body has x=0, y=0, width=30, height=20.
    // body.top is 0.
    const topPt = scene.objects["topPt"] as any;
    const outerWidth = scene.objects["outerWidth"] as any;
    expect(topPt.y).toBe(0);
    expect(outerWidth.x).toBe(30);
    expect((scene.values as any).doubledWidth).toBe(60);

    // Now verify that accessing private/non-exported keys is BLOCKED!
    const invalidDoc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      components: doc.components,
      objects: {
        h1: {
          type: "component",
          use: "hinge"
        } as any,
        // Invalid reference to a private internal object "body"
        invalidPt: {
          type: "point",
          at: "h1.body.center"
        } as any
      }
    };

    const invalidValidator = new Validator(invalidDoc);
    expect(() => invalidValidator.validate()).toThrow();
  });

  it("supports fallback to inner objects when no exports block is defined", () => {
    const doc: RelGeoDocument = {
      version: 0.4,
      scene: { unit: "px" },
      components: {
        noExportComp: {
          parameters: {
            rad: 5
          },
          objects: {
            hole: {
              type: "circle",
              center: [10, 10],
              radius: "rad"
            } as any
          }
        }
      },
      objects: {
        h1: {
          type: "component",
          use: "noExportComp",
          params: {
            rad: 15
          }
        } as any,
        // Access nested public hole directly
        holeRadius: {
          type: "point",
          at: ["h1.hole.radius", 0]
        } as any
      }
    };

    // Verify AST validation succeeds
    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();

    const scene = resolveGeometry(doc, { textMetrics: mockTextMetrics });
    const holeRadius = scene.objects["holeRadius"] as any;
    expect(holeRadius.x).toBe(15);
  });

  it("throws validation errors for missing use, unknown component or invalid exports", () => {
    const missingUse: RelGeoDocument = {
      version: 0.4,
      objects: {
        h1: {
          type: "component"
        } as any
      }
    };
    expect(() => new Validator(missingUse).validate()).toThrow(/requires "use"/);

    const unknownComp: RelGeoDocument = {
      version: 0.4,
      objects: {
        h1: {
          type: "component",
          use: "nonexistent"
        } as any
      }
    };
    expect(() => new Validator(unknownComp).validate()).toThrow(/component "nonexistent" not found/);

    const invalidExport: RelGeoDocument = {
      version: 0.4,
      components: {
        myComp: {
          exports: {
            top: "body.nonexistent"
          },
          objects: {
            body: {
              type: "rect",
              size: [10, 10]
            }
          }
        }
      },
      objects: {}
    };
    expect(() => new Validator(invalidExport).validate()).toThrow(/Invalid export expression/);
  });
});
