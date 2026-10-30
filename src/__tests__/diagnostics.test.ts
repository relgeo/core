import { describe, expect, it } from "vitest";
import { collectDiagnostics, parseRelGeo, toDiagnostic } from "../index";

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
});
