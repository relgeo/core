import { describe, expect, it } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry, ResolveError } from "../resolver";
import { ValidationError, Validator } from "../validator";
import { CoreError } from "../errors";
import { resolveBoolean } from "../resolver/primitives/shapes";
import { createEvalContext } from "../resolver/eval-context";
import { defaultTextMetricsProvider } from "../types";
import { evaluateExpression } from "../evaluator";
import { toDiagnostic } from "../errors";

describe("structured resolver errors", () => {
  it("preserves geometry-owned diagnostic codes at the resolver boundary", () => {
    const error = new ResolveError("transform contains a non-finite value", "INVALID_TRANSFORM", "panel", "objects.panel");

    expect(error).toMatchObject({
      code: "INVALID_TRANSFORM",
      objectId: "panel",
      path: "objects.panel",
      phase: "resolve",
    });
    expect(error.message).toContain("INVALID_TRANSFORM");
  });

  it("keeps geometry transform failures registered at the public boundary", () => {
    const diagnostic = toDiagnostic(new Error("INVALID_TRANSFORM: transform contains a non-finite value"), {
      phase: "resolve",
    });

    expect(diagnostic).toMatchObject({
      code: "INVALID_TRANSFORM",
      phase: "resolve",
      message: "transform contains a non-finite value",
    });
  });

  it("normalizes uncategorized resolver exceptions with object context", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "unknown-object-type" },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrow(ResolveError);

    try {
      resolveGeometry(doc, { mode: "editor" });
      throw new Error("expected resolver failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolveError);
      expect(error).toMatchObject({
        code: "INVALID_OBJECT_TYPE",
        objectId: "broken",
        path: "objects.broken",
      });
      expect((error as Error).message).toContain("Unknown object type");
    }
  });

  it("preserves validation code and path at the resolver boundary", () => {
    const doc = parseRelGeo(
      `version: 0.5
objects:
  panel:
    type: rect
`,
      { mode: "editor" },
    );

    try {
      resolveGeometry(doc, { mode: "compile" });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({
        code: "MISSING_REQUIRED_FIELD",
        phase: "validate",
        path: "objects.panel",
      });
    }
  });

  it("normalizes raw validator exceptions for direct validator consumers", () => {
    const doc = {
      version: "0.5",
      objects: {
        point: { type: "point", at: "missing.center" },
      },
    } as any;

    expect(() => new Validator(doc).validate()).toThrow(ValidationError);
    try {
      new Validator(doc).validate();
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).code).toBeTruthy();
      expect((error as Error).message).not.toBe("[object Object]");
    }
  });

  it("preserves evaluator semantic codes when validator checks expressions", () => {
    const cases = [
      {
        doc: {
          version: "0.5",
          objects: { point: { type: "point", at: "missing" } },
        },
        code: "UNKNOWN_IDENTIFIER",
      },
      {
        doc: {
          version: "0.5",
          objects: {
            panel: { type: "rect", size: [10, 10], place: { topLeft: [0, 0] } },
            point: { type: "point", at: "panel.notAnAnchor" },
          },
        },
        code: "UNKNOWN_ANCHOR",
      },
      {
        doc: {
          version: "0.5",
          objects: {
            path: { type: "path", points: [[0, 0], [10, 0]], closed: false },
            point: { type: "point", at: "path.area" },
          },
        },
        code: "PATH_NOT_CLOSED",
      },
    ] as const;

    for (const { doc, code } of cases) {
      expect(() => new Validator(doc as any).validate()).toThrowError(expect.objectContaining({
        code,
        phase: "validate",
      }));
    }
  });

  it("preserves the expression field path for missing named anchors", () => {
    const doc = {
      version: "0.5",
      objects: {
        panel: { type: "rect", size: [10, 10], place: { topLeft: [0, 0] } },
        marker: { type: "point", at: "panel.notAnAnchor" },
      },
    } as any;

    try {
      new Validator(doc).validate();
      throw new Error("expected missing anchor validation failure");
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNKNOWN_ANCHOR",
        objectId: undefined,
        path: "objects.marker.at",
        phase: "validate",
      });
    }
  });

  it("preserves structured errors from per-object resolver helpers", () => {
    const doc = {
      version: "0.5",
      objects: {
        label: { type: "annotation", text: "hello" },
      },
    } as any;

    const textMetrics = {
      measure: () => {
        throw new CoreError("text metrics unavailable", "INVALID_VALUE", {
          phase: "runtime",
          path: "textMetrics",
        });
      },
    };

    expect(() => resolveGeometry(doc, { mode: "editor", textMetrics })).toThrowError(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "runtime",
      path: "textMetrics",
    }));
  });

  it("keeps divide helper failures structured with field context", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "divide", count: 0, target: "missing" },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.count",
    }));
  });

  it("normalizes dynamic divide counts with the count field path", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "divide", count: "missingCount", target: "line" },
        line: { type: "line", from: [0, 0], to: [10, 0] },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_IDENTIFIER",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.count",
    }));
  });

  it("keeps clone helper reference failures structured with field context", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "clone", of: "missing" },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_REFERENCE",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.of",
    }));
  });

  it("keeps repeat helper validation failures structured with field context", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: {
          type: "repeat",
          count: 0.5,
          item: { type: "point", at: [0, 0] },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "INVALID_REPEAT_COUNT",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.count",
    }));
  });

  it("normalizes dynamic repeat counts with the count field path", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: {
          type: "repeat",
          count: "missingCount",
          item: { type: "point", at: [0, 0] },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_IDENTIFIER",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.count",
    }));
  });

  it("normalizes typed component parameter expression failures with parameter context", () => {
    const doc = {
      version: "0.5",
      components: {
        panel: {
          parameters: { width: { type: "number", default: 10 } },
          objects: { body: { type: "rect", size: ["width", 5] } },
        },
      },
      objects: {
        broken: { type: "component", use: "panel", params: { width: "missingWidth" } },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_IDENTIFIER",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.params.width",
    }));
  });

  it("keeps collection access failures structured with runtime context", () => {
    const doc = {
      version: "0.5",
      objects: {
        holes: {
          type: "repeat",
          count: 2,
          item: { type: "circle", radius: 5, center: [0, 0] },
        },
        broken: { type: "point", at: ["holes[5].radius", 10] },
      },
    } as any;

    expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
      code: "INVALID_COLLECTION_ACCESS",
      phase: "runtime",
      objectId: "broken",
      path: "objects.broken",
    }));
  });

  it("keeps array index failures structured with runtime context", () => {
    const doc = {
      version: "0.5",
      parameters: {
        points: { type: "array", default: [10, 20] },
      },
      objects: {
        broken: { type: "point", at: ["points[2]", 0] },
      },
    } as any;

    expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
      code: "INVALID_COLLECTION_ACCESS",
      phase: "runtime",
      objectId: "broken",
      path: "objects.broken",
    }));
  });

  it("keeps boolean operand lookup failures structured in editor resolution", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "boolean", operation: "union", shapes: ["missing"] },
      },
    } as any;

    expect(() => resolveBoolean("broken", doc.objects.broken, {
      scalars: {},
      objects: {},
      targetUnit: "px",
      mode: "validate",
      textMetrics: defaultTextMetricsProvider,
    })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_REFERENCE",
      phase: "resolve",
      objectId: "broken",
      path: "objects.broken.shapes",
    }));
  });

  it("classifies collection function type errors instead of leaking raw exceptions", () => {
    const doc = {
      version: "0.5",
      objects: {
        broken: { type: "point", at: ["count(1)", 0] },
      },
    } as any;

    const context = createEvalContext({
      scalars: {},
      objects: {},
      targetUnit: "px",
      mode: "validate",
      textMetrics: defaultTextMetricsProvider,
    });
    expect(() => evaluateExpression("count(1)", context)).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      phase: "resolve",
    }));
  });

  it("rejects invalid numeric path offsets at the validation boundary", () => {
    const doc = {
      version: "0.5",
      objects: {
        source: { type: "path", points: [[0, 0], [10, 0]] },
        shifted: {
          type: "path",
          offset: { from: "source", distance: -1 },
        },
      },
    } as any;

    expect(() => new Validator(doc, "validate").validate()).toThrowError(expect.objectContaining({
      code: "INVALID_OFFSET",
      phase: "validate",
      path: "objects.shifted.offset.distance",
    }));
  });

  it("keeps repeat.along length expression failures tied to their field path", () => {
    const doc = {
      version: "0.5",
      objects: {
        guide: { type: "line", from: [0, 0], to: [10, 0] },
        marks: {
          type: "repeat",
          along: {
            target: "guide",
            count: 2,
            spacing: "uniform-t",
            startOffset: "missingOffset",
          },
          item: { type: "circle", radius: 1 },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_IDENTIFIER",
      phase: "resolve",
      objectId: "marks",
      path: "objects.marks.along.startOffset",
    }));
  });

  it("keeps scale and mirror validation codes specific", () => {
    const invalidScale = {
      version: "0.5",
      objects: {
        source: { type: "point", at: [0, 0] },
        scaled: { type: "scale", target: "source", factor: 0 },
      },
    } as any;
    const invalidMirror = {
      version: "0.5",
      objects: {
        source: { type: "point", at: [0, 0] },
        mirrored: { type: "mirror", target: "source", axis: "diagonal" },
      },
    } as any;
    const invalidHole = {
      version: "0.5",
      objects: {
        panel: {
          type: "rect",
          size: [10, 10],
          holes: [{ triangle: { points: [[1, 1], [2, 1], [1, 2]] } }],
        },
      },
    } as any;
    const invalidOperationTarget = {
      version: "0.5",
      objects: {
        note: { type: "text", content: "not geometry", at: [0, 0] },
        shifted: { type: "translate", target: "note", by: [1, 0] },
      },
    } as any;

    expect(() => new Validator(invalidScale, "validate").validate()).toThrowError(expect.objectContaining({
      code: "INVALID_SCALE_FACTOR",
      path: "objects.scaled.factor",
      phase: "validate",
    }));
    expect(() => new Validator(invalidMirror, "validate").validate()).toThrowError(expect.objectContaining({
      code: "INVALID_MIRROR_AXIS",
      path: "objects.mirrored.axis",
      phase: "validate",
    }));
    expect(() => new Validator(invalidHole, "validate").validate()).toThrowError(expect.objectContaining({
      code: "INVALID_HOLE_SHAPE",
      path: "objects.panel.holes[0]",
      phase: "validate",
    }));
    expect(() => new Validator(invalidOperationTarget, "validate").validate()).toThrowError(expect.objectContaining({
      code: "INVALID_OPERATION_TARGET",
      path: "objects.shifted.target",
      phase: "validate",
    }));
    expect(() => resolveGeometry(invalidScale, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "INVALID_SCALE_FACTOR",
      objectId: "scaled",
      path: "factor",
      phase: "resolve",
    }));
  });

  it("classifies repeat-along length failures with repeat context", () => {
    const doc = {
      version: "0.5",
      objects: {
        target: { type: "point", at: [0, 0] },
        repeated: {
          type: "repeat",
          along: { target: "target", spacing: "uniform-length", count: 2 },
          item: { type: "point", at: [0, 0] },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "REPEAT_ALONG_LENGTH_FAILED",
      objectId: "repeated",
      path: "objects.repeated.along",
      phase: "resolve",
    }));
  });

  it("does not leak a raw Error for non-finite repeat lengths", () => {
    const doc = {
      version: "0.5",
      objects: {
        guide: { type: "line", from: [0, 0], to: [10, 0] },
        repeated: {
          type: "repeat",
          along: {
            target: "guide",
            count: 2,
            spacing: "uniform-t",
            startOffset: Number.POSITIVE_INFINITY,
          },
          item: { type: "point", at: [0, 0] },
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "resolve",
      objectId: "repeated",
      path: "objects.repeated.along.startOffset",
    }));
  });

  it("attaches stable sheet paths to expression failures", () => {
    const doc = {
      version: "0.5",
      objects: { origin: { type: "point", at: [0, 0] } },
      views: { detail: { target: "origin" } },
      sheets: {
        primary: {
          size: [Number.POSITIVE_INFINITY, 100],
          views: [{ use: "detail", place: { topLeft: [0, 0] } }],
        },
      },
    } as any;

    expect(() => resolveGeometry(doc, { mode: "editor" })).toThrowError(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "resolve",
      path: "sheets.primary.size[0]",
    }));
  });
});
