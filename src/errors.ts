import type {
  RelGeoDiagnostic,
  RelGeoDiagnosticPhase,
  RelGeoDiagnosticSeverity,
  RelGeoError,
  SourceRange,
} from "./types";
import { ResolveError } from "./resolver/types";

const ERROR_CODE_PREFIX = /^([A-Z][A-Z0-9_]*):\s*/;

const RUNTIME_CODES = new Set([
  "BOOLEAN_EMPTY_RESULT",
  "BOOLEAN_FAILED",
  "BOOLEAN_MULTIPART_RESULT",
  "FRAME_RESOLUTION_FAILED",
  "INVALID_T_AT_LENGTH",
  "PATH_LENGTH_UNAVAILABLE",
  "INVALID_RESOLVED_SCENE",
]);

export interface DiagnosticOptions {
  phase?: RelGeoDiagnosticPhase;
  severity?: RelGeoDiagnosticSeverity;
  range?: SourceRange;
  fallbackCode?: string;
}

function inferPhase(code: string): RelGeoDiagnosticPhase {
  if (RUNTIME_CODES.has(code)) return "runtime";
  if (code === "CONSTRAINT_VIOLATION") return "constraint";
  if (code === "INVALID_YAML" || code === "UNSUPPORTED_SPEC_VERSION") return "parse";
  if (
    code.startsWith("UNKNOWN_") ||
    code.startsWith("INVALID_") ||
    code.startsWith("MISSING_") ||
    code === "TYPE_MISMATCH" ||
    code === "DIVISION_BY_ZERO"
  ) return "validate";
  return "resolve";
}

/** Convert any public-boundary failure into the stable diagnostic shape. */
export function toDiagnostic(error: unknown, options: DiagnosticOptions = {}): RelGeoDiagnostic {
  const candidate = (error && typeof error === "object" ? error : {}) as Partial<RelGeoError>;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const prefixedCode = rawMessage.match(ERROR_CODE_PREFIX)?.[1];
  const code = candidate.code ?? prefixedCode ?? options.fallbackCode ?? "UNKNOWN_ERROR";
  const message = prefixedCode ? rawMessage.replace(ERROR_CODE_PREFIX, "") : rawMessage;
  const inferredPhase = inferPhase(code);
  const phase = inferredPhase === "runtime" && (!options.phase || options.phase === "resolve")
    ? "runtime"
    : options.phase
      ?? (candidate.phase === "resolve" && inferredPhase === "runtime" ? "runtime" : candidate.phase)
      ?? inferredPhase;
  const severity = candidate.severity ?? options.severity ?? "error";

  return {
    code,
    message,
    path: candidate.path,
    objectId: candidate.objectId,
    dependencyChain: candidate.dependencyChain,
    phase,
    severity,
    range: candidate.range ?? options.range,
  };
}

/** Stable phase/path/code ordering for multi-diagnostic consumers. */
export function sortDiagnostics(diagnostics: RelGeoDiagnostic[]): RelGeoDiagnostic[] {
  const phaseOrder: Record<RelGeoDiagnosticPhase, number> = {
    parse: 0,
    validate: 1,
    resolve: 2,
    runtime: 3,
    constraint: 4,
  };
  const unique = new Map<string, RelGeoDiagnostic>();
  for (const diagnostic of diagnostics) {
    const range = diagnostic.range ? `${diagnostic.range.start.line}:${diagnostic.range.start.column}` : "";
    const key = [diagnostic.phase, diagnostic.path ?? "", diagnostic.code, diagnostic.message, range].join("\u0000");
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()].sort((left, right) => {
    const phaseDelta = phaseOrder[left.phase] - phaseOrder[right.phase];
    if (phaseDelta) return phaseDelta;
    const leftLine = left.range?.start.line ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.range?.start.line ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    const leftColumn = left.range?.start.column ?? Number.MAX_SAFE_INTEGER;
    const rightColumn = right.range?.start.column ?? Number.MAX_SAFE_INTEGER;
    if (leftColumn !== rightColumn) return leftColumn - rightColumn;
    return [left.path ?? "", left.code, left.message].join("\u0000")
      .localeCompare([right.path ?? "", right.code, right.message].join("\u0000"));
  });
}

/**
 * Converts an uncategorized exception into the structured runtime error used
 * by the public resolver boundary. Existing ResolveError instances retain
 * their code/path payload and only receive missing fallback context.
 */
export function normalizeResolveError(
  error: unknown,
  objectId?: string,
  path?: string,
): ResolveError {
  if (error instanceof ResolveError) {
    if (objectId && !error.objectId) error.objectId = objectId;
    if (path && !error.path) error.path = path;
    return error;
  }

  const candidate = (error && typeof error === "object" ? error : {}) as Partial<RelGeoError>;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const prefixedCode = rawMessage.match(ERROR_CODE_PREFIX)?.[1];
  const code = candidate.code ?? prefixedCode ?? "RESOLVE_ERROR";
  const message = prefixedCode ? rawMessage.replace(ERROR_CODE_PREFIX, "") : rawMessage;

  return new ResolveError(
    message,
    code,
    candidate.objectId ?? objectId,
    candidate.path ?? path,
    candidate.range,
  );
}
