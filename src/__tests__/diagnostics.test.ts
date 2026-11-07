import { describe, expect, it } from "vitest";
import {
  collectDiagnostics,
  aggregateDiagnostics,
  evaluateExpression,
  parseRelGeo,
  resolveGeometry,
  sortDiagnostics,
  toDiagnostic,
} from "../index";
import { CoreError } from "../errors";

describe("public diagnostic contract", () => {
  it("aggregates independent local validation failures in stable order", () => {
    const source = `version: 0.5
objects:
  first:
    type: rect
  second:
    type: rect
`;

    const diagnostics = collectDiagnostics(source);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_REQUIRED_FIELD",
      "MISSING_REQUIRED_FIELD",
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.objectId)).toEqual(["first", "second"]);
    expect(diagnostics.every((diagnostic) =>
      diagnostic.phase === "validate" && diagnostic.severity === "error" && diagnostic.range,
    )).toBe(true);
  });

  it("returns a parse diagnostic with a source range for invalid YAML", () => {
    const diagnostics = collectDiagnostics("version: [0.5\n");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "INVALID_YAML",
      phase: "parse",
      severity: "error",
    });
    expect(diagnostics[0].range?.start.line).toBeGreaterThanOrEqual(0);
  });

  it("retains a best-effort source range for semantic parse failures", () => {
    const source = `version: 0.5
objects:
  bad:
    type: rect
`;

    expect(() => parseRelGeo(source, { mode: "compile" })).toThrow(expect.objectContaining({
      code: "MISSING_REQUIRED_FIELD",
      path: "objects.bad.size",
      range: expect.objectContaining({ start: expect.objectContaining({ line: 2 }) }),
    }));
  });

  it("keeps strict parse and resolve behavior unchanged", () => {
    const doc = parseRelGeo("version: 0.5\nobjects: {}\n");
    expect(doc.objects).toEqual({});
    expect(collectDiagnostics(doc)).toEqual([]);
  });

  it("keeps runtime error codes distinct at the diagnostic boundary", () => {
    const diagnostic = toDiagnostic(new Error("BOOLEAN_EMPTY_RESULT: intersection is empty"), {
      phase: "resolve",
    });

    expect(diagnostic).toMatchObject({
      code: "BOOLEAN_EMPTY_RESULT",
      message: "intersection is empty",
      phase: "runtime",
      severity: "error",
    });
  });

  it("preserves runtime phase and object context in collected diagnostics", () => {
    const diagnostics = collectDiagnostics(`version: 0.5
objects:
  left:
    type: rect
    size: [10, 10]
    place:
      topLeft: [0, 0]
  right:
    type: rect
    size: [10, 10]
    place:
      topLeft: [20, 0]
  empty:
    type: boolean
    operation: intersect
    shapes: [left, right]
`);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "BOOLEAN_EMPTY_RESULT",
      phase: "runtime",
      objectId: "empty",
      path: "objects.empty",
    }));
  });

  it("collects independent runtime failures after strict resolution stops at the first one", () => {
    const diagnostics = collectDiagnostics({
      version: "0.5",
      objects: {
        leftA: { type: "rect", size: [10, 10], place: { topLeft: [0, 0] } },
        rightA: { type: "rect", size: [10, 10], place: { topLeft: [20, 0] } },
        emptyA: { type: "boolean", operation: "intersect", shapes: ["leftA", "rightA"] },
        leftB: { type: "rect", size: [10, 10], place: { topLeft: [100, 0] } },
        rightB: { type: "rect", size: [10, 10], place: { topLeft: [120, 0] } },
        emptyB: { type: "boolean", operation: "intersect", shapes: ["leftB", "rightB"] },
      },
    });

    const emptyResults = diagnostics.filter((diagnostic) => diagnostic.code === "BOOLEAN_EMPTY_RESULT");
    expect(emptyResults.map((diagnostic) => diagnostic.objectId)).toEqual(["emptyA", "emptyB"]);
    expect(emptyResults.every((diagnostic) => diagnostic.phase === "runtime")).toBe(true);
  });

  it("normalizes unregistered codes instead of leaking them", () => {
    const diagnostic = toDiagnostic(new Error("NOT_REGISTERED: internal failure"), {
      phase: "resolve",
    });

    expect(diagnostic).toMatchObject({
      code: "UNKNOWN_ERROR",
      message: "internal failure",
      phase: "resolve",
      severity: "error",
    });
  });

  it("sanitizes malformed compatible errors at the public boundary", () => {
    const diagnostic = toDiagnostic(Object.assign(new Error("INTERNAL_CODE: unsafe detail"), {
      code: "INTERNAL_CODE",
      phase: "host",
      severity: "fatal",
      path: "objects.panel",
    }), { phase: "resolve" });

    expect(diagnostic).toMatchObject({
      code: "UNKNOWN_ERROR",
      phase: "resolve",
      severity: "error",
      message: "unsafe detail",
      path: "objects.panel",
    });
    expect(["parse", "validate", "resolve", "runtime", "constraint"]).toContain(diagnostic.phase);
    expect(["error", "warning", "info"]).toContain(diagnostic.severity);
  });

  it("uses a safe message for structured non-Error failures", () => {
    expect(toDiagnostic({ code: "UNKNOWN_INTERNAL", message: "UNKNOWN_INTERNAL: callback failed" }, {
      phase: "runtime",
    })).toMatchObject({
      code: "UNKNOWN_ERROR",
      phase: "runtime",
      severity: "error",
      message: "callback failed",
    });
  });

  it("aggregates independent boundary failures with deterministic dedupe and truncation", () => {
    const diagnostics = aggregateDiagnostics([
      new Error("Unknown identifier: second"),
      new Error("Unknown identifier: first"),
      new Error("Unknown identifier: first"),
    ], { phase: "validate", maxDiagnostics: 2 });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "Unknown identifier: first",
      "Unknown identifier: second",
    ]);
    expect(diagnostics.every(({ code, phase }) => code === "UNKNOWN_IDENTIFIER" && phase === "validate")).toBe(true);
  });

  it("normalizes boolean perimeter failures to the registered path-length code", () => {
    expect(() => evaluateExpression("perimeter(shape)", {
      scalars: {},
      targetUnit: "px",
      objects: { shape: { type: "boolean" } } as never,
    })).toThrow(expect.objectContaining({
      code: "PATH_LENGTH_UNAVAILABLE",
    }));
  });

  it("exposes structured evaluator failures at the public boundary", () => {
    expect(() => evaluateExpression("10 / 0", {
      scalars: {},
      targetUnit: "px",
    })).toThrow(expect.objectContaining({
      code: "DIVISION_BY_ZERO",
      phase: "resolve",
      severity: "error",
    }));
  });

  it("preserves a structured evaluator phase across the public helper", () => {
    expect(() => evaluateExpression("custom()", {
      scalars: {},
      targetUnit: "px",
      callFunction: () => {
        throw new CoreError("runtime callback failed", "INVALID_VALUE", {
          phase: "runtime",
          path: "custom",
        });
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "runtime",
      path: "custom",
    }));
  });

  it("preserves compatible structured errors that are not CoreError instances", () => {
    const callbackError = Object.assign(new Error("runtime callback failed"), {
      code: "INVALID_VALUE",
      phase: "runtime",
      path: "custom",
    });

    expect(() => evaluateExpression("custom()", {
      scalars: {},
      targetUnit: "px",
      callFunction: () => {
        throw callbackError;
      },
    })).toThrow(expect.objectContaining({
      code: "INVALID_VALUE",
      phase: "runtime",
      path: "custom",
    }));
  });

  it("classifies collection boundary failures as runtime diagnostics", () => {
    expect(toDiagnostic(new Error("INVALID_COLLECTION_ACCESS: first() called on empty collection"), {
      phase: "resolve",
    })).toMatchObject({
      code: "INVALID_COLLECTION_ACCESS",
      phase: "runtime",
      message: "first() called on empty collection",
    });
  });

  it("carries structured constraint context into diagnostics", () => {
    const diagnostics = collectDiagnostics({
      version: "0.5",
      objects: {
        first: { type: "point", at: [0, 0] },
        second: { type: "point", at: [10, 10] },
      },
      constraints: [{ align: { target: "first", with: "second" } }],
    });

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "CONSTRAINT_VIOLATION",
      constraintType: "align",
      origin: "constraint",
      expected: { deviation: 0, tolerance: 0.001 },
      actual: { deviation: expect.any(Number) },
    }));
  });

  it("normalizes raw evaluator failures to actionable catalog codes", () => {
    expect(toDiagnostic(new Error("Path \"open\" must be closed to expose area"))).toMatchObject({
      code: "PATH_NOT_CLOSED",
      phase: "resolve",
    });
    expect(toDiagnostic(new Error("Unknown object in pointAt: missing"), { phase: "resolve" })).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      phase: "resolve",
    });
    expect(toDiagnostic(new Error("INVALID_T_PARAMETER: pointAt parameter t must be between 0 and 1"), { phase: "resolve" })).toMatchObject({
      code: "INVALID_VALUE",
      phase: "resolve",
    });
  });

  it("keeps evaluator error categories distinct at the public boundary", () => {
    const cases = [
      ["intersection() requires at least 2 arguments", "INVALID_INTERSECTION_INPUT"],
      ["Cannot resolve point-like argument: missing", "TYPE_MISMATCH"],
      ["Operation target missing not found", "UNKNOWN_REFERENCE"],
      ["Arc \"curve\" does not expose a resolvable length", "PATH_LENGTH_UNAVAILABLE"],
      ["project() requires a line target, got circle", "TYPE_MISMATCH"],
      ["Arithmetic operations are only allowed on numbers/lengths", "TYPE_MISMATCH"],
      ["Relational operators are only allowed on numbers", "TYPE_MISMATCH"],
      ["Index must be a number", "TYPE_MISMATCH"],
      ["Invalid token: @", "INVALID_EXPRESSION"],
    ] as const;

    for (const [message, code] of cases) {
      expect(toDiagnostic(new Error(message), { phase: "resolve" })).toMatchObject({
        code,
        phase: code === "PATH_LENGTH_UNAVAILABLE" ? "runtime" : "resolve",
      });
    }
  });

  it("preserves validation phase and path at the resolve boundary", () => {
    expect(() => resolveGeometry({
      version: "0.5",
      objects: {
        panel: { type: "rect" },
      },
    } as any)).toThrow(expect.objectContaining({
      code: "MISSING_REQUIRED_FIELD",
      phase: "validate",
      path: "objects.panel",
    }));
  });

  it("sorts by phase, source position, path, and code without locale dependence", () => {
    const diagnostics = sortDiagnostics([
      {
        code: "UNKNOWN_FIELD",
        message: "field",
        phase: "validate",
        severity: "error",
        path: "objects.z.field",
        range: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
      },
      {
        code: "INVALID_YAML",
        message: "yaml",
        phase: "parse",
        severity: "error",
      },
      {
        code: "MISSING_REQUIRED_FIELD",
        message: "field",
        phase: "validate",
        severity: "error",
        path: "objects.a.type",
        range: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
      },
      {
        code: "UNKNOWN_FIELD",
        message: "field",
        phase: "validate",
        severity: "error",
        path: "objects.z.field",
        range: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
      },
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_YAML",
      "MISSING_REQUIRED_FIELD",
      "UNKNOWN_FIELD",
    ]);
  });

  it("deduplicates only diagnostics with the same public identity", () => {
    const diagnostics = sortDiagnostics([
      {
        code: "UNKNOWN_REFERENCE",
        message: "missing",
        phase: "resolve",
        severity: "error",
        path: "objects.first.target",
        objectId: "first",
      },
      {
        code: "UNKNOWN_REFERENCE",
        message: "missing",
        phase: "resolve",
        severity: "error",
        path: "objects.first.target",
        objectId: "second",
      },
      {
        code: "UNKNOWN_REFERENCE",
        message: "missing",
        phase: "resolve",
        severity: "error",
        path: "objects.first.target",
        objectId: "first",
      },
    ]);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ objectId }) => objectId)).toEqual(["first", "second"]);
  });

  it("applies diagnostic truncation after deterministic ordering", () => {
    const diagnostics = collectDiagnostics(`version: 0.5
objects:
  first:
    type: rect
  second:
    type: rect
`, { maxDiagnostics: 1 });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].path).toBe("objects.first");
  });

  it("keeps tolerant parsing non-throwing while strict validation remains structured", () => {
    const source = `version: 0.5
objects:
  panel:
    type: rect
`;

    expect(() => parseRelGeo(source, { mode: "editor" })).not.toThrow();
    expect(() => parseRelGeo(source, { mode: "validate" })).toThrow(expect.objectContaining({
      code: "MISSING_REQUIRED_FIELD",
      path: "objects.panel.size",
      phase: "parse",
      severity: "error",
    }));
  });
});
