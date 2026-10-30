import { describe, expect, it } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry, ResolveError } from "../resolver";
import { ValidationError, Validator } from "../validator";

describe("structured resolver errors", () => {
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
        code: "RESOLVE_ERROR",
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
      expect(error).toBeInstanceOf(ResolveError);
      expect(error).toMatchObject({
        code: "MISSING_REQUIRED_FIELD",
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
});
