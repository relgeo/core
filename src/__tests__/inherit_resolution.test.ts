import { describe, expect, it } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument, ResolvedLine } from "../types";

describe("inherit resolution", () => {
  it("re-evaluates inherited and overridden component parameters in dependency order", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      constants: {
        sizes: { base: 4 },
      },
      components: {
        dependentPanel: {
          parameters: {
            height: { type: "number", default: 15 },
            width: { type: "number", default: 10 },
            base: { type: "number", default: 1 },
          },
          objects: {
            panel: { type: "rect", size: ["width", "height"] } as any,
          },
        },
      },
      objects: {
        panel1: {
          type: "component",
          use: "dependentPanel",
          // Reverse declaration order is intentional.
          params: {
            inherit: "sizes",
            height: "width + 5",
            width: "base * 2",
          },
        } as any,
      },
    };

    const panel = resolveGeometry(doc).objects["panel1.panel"] as any;
    expect(panel.width).toBe(8);
    expect(panel.height).toBe(13);
  });

  it("applies ordered multiple inherit on component params before local overrides", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "mm" },
      constants: {
        commonBracket: {
          width: 120,
          thickness: 6,
        },
        standardBoltM6: {
          diameter: 6,
          clearance: 0.5,
        },
      },
      components: {
        holeMark: {
          parameters: {
            diameter: { type: "length", default: 4 },
            clearance: { type: "length", default: 0 },
            width: { type: "length", default: 10 },
          },
          objects: {
            guide: {
              type: "line",
              from: [0, 0],
              to: ["width + diameter + clearance", 0],
            },
          },
          exports: {
            end: "guide.end",
          },
        },
      },
      objects: {
        hole1: {
          type: "component",
          use: "holeMark",
          params: {
            inherit: ["commonBracket", "standardBoltM6"],
            diameter: 8,
          },
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const guide = resolved.objects["hole1.guide"] as ResolvedLine;
    expect(guide.x2).toBeCloseTo(128.5);
  });

  it("merges metaPreset, meta.inherit, and local meta in normative order", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "mm" },
      constants: {
        inspectionOverlay: {
          dash: "4 2",
          opacity: 0.7,
          strokeWidth: 3,
        },
      },
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
          to: [10, 0],
          metaPreset: "guideLine",
          meta: {
            inherit: "inspectionOverlay",
            strokeWidth: 2,
            intent: "centerline",
          },
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const line = resolved.objects.centerLine as ResolvedLine;
    expect(line.meta?.stroke).toBe("#999999");
    expect(line.meta?.dash).toBe("4 2");
    expect(line.meta?.opacity).toBe(0.7);
    expect(line.meta?.strokeWidth).toBe(2);
    expect(line.meta?.intent).toBe("centerline");
  });

  it("resolves meta.inherit from metaPresets before local meta overrides", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      scene: { unit: "mm" },
      metaPresets: {
        finalStroke: {
          role: "final",
          stroke: "#111827",
          strokeWidth: 1,
        },
        inspectionMark: {
          inherit: "finalStroke",
          dash: "4 2",
          opacity: 0.7,
        },
      },
      objects: {
        mark: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
          meta: {
            inherit: "inspectionMark",
            intent: "inspection-mark",
            strokeWidth: 2,
          },
        },
      },
    };

    const resolved = resolveGeometry(doc);
    const mark = resolved.objects.mark as ResolvedLine;
    expect(mark.meta?.role).toBe("final");
    expect(mark.meta?.stroke).toBe("#111827");
    expect(mark.meta?.dash).toBe("4 2");
    expect(mark.meta?.opacity).toBe(0.7);
    expect(mark.meta?.strokeWidth).toBe(2);
    expect(mark.meta?.intent).toBe("inspection-mark");
  });

  it("throws CIRCULAR_INHERIT for cyclic structured inherit chains", () => {
    const doc: RelGeoDocument = {
      version: 0.5,
      constants: {
        a: { inherit: "b", stroke: "#111111" },
        b: { inherit: "a", stroke: "#222222" },
      },
      objects: {
        centerLine: {
          type: "line",
          from: [0, 0],
          to: [10, 0],
          meta: {
            inherit: "a",
          },
        },
      },
    };

    expect(() => resolveGeometry(doc)).toThrow(/CIRCULAR_INHERIT/);
  });
});
