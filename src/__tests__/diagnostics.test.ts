import { describe, expect, it } from "vitest";
import {
  collectDiagnostics,
  evaluateExpression,
  parseRelGeo,
  sortDiagnostics,
  toDiagnostic,
} from "../index";

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
