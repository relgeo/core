import type {
  ConstraintViolation,
  RelGeoDiagnostic,
  RelGeoDocument,
  RelGeoMode,
  SourceRange,
} from "./types";
import { ParseError, parseRelGeo } from "./parser";
import { Validator } from "./validator";
import { resolveGeometry } from "./resolver";
import { sortDiagnostics, toDiagnostic } from "./errors";

export interface CollectDiagnosticsOptions {
  mode?: RelGeoMode;
  includeResolution?: boolean;
  maxDiagnostics?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rangeForPath(source: string | undefined, path: string | undefined): SourceRange | undefined {
  if (!source || !path) return undefined;
  const rawPart = path.split(".").at(-1)?.replace(/\[\d+\]/g, "");
  if (!rawPart) return undefined;
  const key = rawPart.replace(/^['"]|['"]$/g, "");
  const pattern = new RegExp(`^\\s*(?:["']${escapeRegExp(key)}["']|${escapeRegExp(key)}):`);
  const lines = source.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line].match(pattern);
    if (!match) continue;
    const startColumn = match[0].search(/\S/);
    return {
      start: { line, column: Math.max(0, startColumn) },
      end: { line, column: lines[line].length },
    };
  }
  return undefined;
}

function pushValidationDiagnostic(
  diagnostics: RelGeoDiagnostic[],
  error: unknown,
  source?: string,
  objectId?: string,
): void {
  const candidate = error && typeof error === "object" ? error as { path?: string; objectId?: string } : {};
  diagnostics.push(toDiagnostic(error, {
    phase: "validate",
    range: rangeForPath(source, candidate.path),
  }));
  const last = diagnostics.at(-1);
  const pathObjectId = candidate.path?.match(/^objects\.([^.[\]]+)/)?.[1];
  if (last && !last.objectId) last.objectId = objectId ?? pathObjectId;
}

/**
 * Collect bounded, deterministic diagnostics without changing strict resolver
 * behavior. The per-object pass adds independent local structural failures;
 * cross-object semantics still use the normal full-document validator.
 */
export function collectDiagnostics(
  input: string | RelGeoDocument,
  options: CollectDiagnosticsOptions = {},
): RelGeoDiagnostic[] {
  const mode = options.mode ?? "validate";
  const requestedMax = options.maxDiagnostics ?? 100;
  const maxDiagnostics = Number.isFinite(requestedMax)
    ? Math.max(0, Math.floor(requestedMax))
    : 100;
  const diagnostics: RelGeoDiagnostic[] = [];
  let doc: RelGeoDocument;
  let source: string | undefined;

  if (typeof input === "string") {
    source = input;
    try {
      // Editor parsing preserves the document envelope so validation can report
      // more than the first strict-parser failure.
      doc = parseRelGeo(input, { mode: "editor" });
    } catch (error) {
      const parseError = error instanceof ParseError ? error : error;
      diagnostics.push(toDiagnostic(parseError, {
        phase: "parse",
        fallbackCode: "INVALID_YAML",
        range: (parseError as ParseError).range,
      }));
      return sortDiagnostics(diagnostics).slice(0, maxDiagnostics);
    }
  } else {
    doc = input;
  }

  try {
    new Validator(doc, mode).validate();
  } catch (error) {
    pushValidationDiagnostic(diagnostics, error, source);
  }

  for (const [objectId, object] of Object.entries(doc.objects ?? {})) {
    try {
      const isolatedDoc: RelGeoDocument = { ...doc, objects: { [objectId]: object } };
      new Validator(isolatedDoc, mode).validate();
    } catch (error) {
      const candidate = error && typeof error === "object" ? error as { code?: string } : {};
      // Isolated validation is only additional evidence for local structural
      // failures; references are validated against the full document above.
      const localCodes = new Set([
        "UNKNOWN_FIELD",
        "INVALID_OBJECT_TYPE",
        "MISSING_REQUIRED_FIELD",
        "INVALID_VALUE",
        "INVALID_BOOLEAN_OPERATION",
        "TYPE_MISMATCH",
      ]);
      if (!candidate.code || localCodes.has(candidate.code)) {
        pushValidationDiagnostic(diagnostics, error, source, objectId);
      }
    }
  }

  const orderedValidation = sortDiagnostics(diagnostics);
  if (orderedValidation.length === 0 && options.includeResolution !== false) {
    try {
      const scene = resolveGeometry(doc, { mode });
      for (const violation of scene.violations ?? []) {
        diagnostics.push(diagnosticFromConstraint(violation));
      }
    } catch (error) {
      diagnostics.push(toDiagnostic(error, { phase: "resolve" }));
    }
  }

  return sortDiagnostics(diagnostics).slice(0, maxDiagnostics);
}

function diagnosticFromConstraint(violation: ConstraintViolation): RelGeoDiagnostic {
  return {
    code: "CONSTRAINT_VIOLATION",
    message: violation.message,
    path: violation.path,
    objectId: violation.involvedObjects[0],
    phase: "constraint",
    severity: "error",
  };
}
