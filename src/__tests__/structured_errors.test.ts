import { describe, expect, it } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry, ResolveError } from "../resolver";
import { ValidationError, Validator } from "../validator";
import { CoreError } from "../errors";

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

    expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
      code: "INVALID_VALUE",
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
});
