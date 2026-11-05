import { load } from "js-yaml";
import type { RelGeoDocument, RelGeoErrorCode, RelGeoMode, RelGeoObject, SourceRange } from "./types";
import { Validator, ValidationError } from "./validator";
import { normalizeErrorCode, stripErrorCodePrefix } from "./errors";

export const ACTIVE_REL_GEO_SPEC_VERSION = "0.5";
export const SUPPORTED_REL_GEO_SPEC_VERSIONS = ["0.4", "0.5"] as const;
export const REGRESSION_ONLY_REL_GEO_SPEC_VERSIONS = ["0.1", "0.2", "0.3"] as const;
export const ACCEPTED_REL_GEO_SPEC_VERSIONS = [
  ...REGRESSION_ONLY_REL_GEO_SPEC_VERSIONS,
  ...SUPPORTED_REL_GEO_SPEC_VERSIONS,
] as const;

export type RelGeoSpecVersionStatus =
  | "active"
  | "supported-legacy"
  | "regression-only"
  | "unsupported";

export function normalizeRelGeoSpecVersion(version: string | number): string {
  return String(version).trim();
}

export function classifyRelGeoSpecVersion(version: string | number): RelGeoSpecVersionStatus {
  const normalized = normalizeRelGeoSpecVersion(version);
  if (normalized === ACTIVE_REL_GEO_SPEC_VERSION) return "active";
  if (SUPPORTED_REL_GEO_SPEC_VERSIONS.includes(normalized as (typeof SUPPORTED_REL_GEO_SPEC_VERSIONS)[number])) {
    return "supported-legacy";
  }
  if (REGRESSION_ONLY_REL_GEO_SPEC_VERSIONS.includes(normalized as (typeof REGRESSION_ONLY_REL_GEO_SPEC_VERSIONS)[number])) {
    return "regression-only";
  }
  return "unsupported";
}

export class ParseError extends Error {
  path?: string;
  code: RelGeoErrorCode;
  phase = "parse" as const;
  severity = "error" as const;
  range?: SourceRange;

  constructor(message: string, path?: string, code?: RelGeoErrorCode, range?: SourceRange) {
    const normalizedCode = normalizeErrorCode(code, message, "INVALID_YAML");
    super(`${normalizedCode}: ${stripErrorCodePrefix(message)}`);
    this.path = path;
    this.code = normalizedCode;
    this.range = range;
    this.name = "ParseError";
  }
}

const TOP_LEVEL_FIELDS = new Set([
  "version",
  "scene",
  "parameters",
  "constants",
  "derived",
  "profiles",
  "metaPresets",
  "styles",
  "components",
  "objects",
  "constraints",
  "meta",
  "sheets",
  "views",
]);

const COMMON_OBJECT_FIELDS = new Set(["id", "type", "meta", "metaPreset", "style", "anchors"]);
const OBJECT_FIELDS: Record<string, Set<string>> = {
  point: new Set(["at", "from", "move", "on"]),
  line: new Set(["from", "to", "direction", "length", "tangent"]),
  rect: new Set(["size", "place", "on", "holes", "transform"]),
  circle: new Set(["center", "radius", "through", "place", "on", "holes", "transform"]),
  ellipse: new Set(["center", "rx", "ry", "size", "rotation", "place", "on", "holes", "transform"]),
  group: new Set(["children", "place", "on", "transform"]),
  text: new Set(["at", "place", "on", "transform", "content", "anchor"]),
  path: new Set(["points", "segments", "join", "closed", "closeWith", "offset", "corners", "corner", "place", "on", "holes", "transform"]),
  polygon: new Set(["points", "corners", "corner", "place", "on", "holes", "transform"]),
  clone: new Set(["of", "place", "on", "transform"]),
  translate: new Set(["target", "by"]),
  rotate: new Set(["target", "angle", "origin"]),
  scale: new Set(["target", "factor", "origin"]),
  mirror: new Set(["target", "axis", "origin"]),
  reverse: new Set(["target"]),
  split: new Set(["target", "at", "pick"]),
  arc: new Set(["from", "through", "to", "center", "radius", "startAngle", "endAngle", "place", "on", "transform"]),
  cubic: new Set(["from", "cp1", "cp2", "to", "place", "on", "transform"]),
  quadratic: new Set(["from", "cp", "to", "place", "on", "transform"]),
  repeat: new Set(["count", "grid", "polar", "each", "along", "item", "place", "transform"]),
  divide: new Set(["target", "count"]),
  collection: new Set(["children"]),
  component: new Set(["use", "params", "place", "on", "transform"]),
  dimension: new Set(["kind", "from", "to", "offset", "target", "between", "text"]),
  annotation: new Set(["target", "text", "leader", "place"]),
  boolean: new Set(["operation", "shapes", "base", "tools", "result", "place", "on", "transform"]),
};

export interface ParseOptions {
  strict?: boolean;
  mode?: RelGeoMode;
}

/** Best-effort semantic path to source range mapping for editor consumers. */
export function sourceRangeForPath(source: string, path?: string): SourceRange | undefined {
  if (!path) return undefined;
  const lines = source.split("\n");
  // Invalid fields may not exist in the source (for example a missing
  // required `size`). Fall back from the deepest path segment to its nearest
  // declared parent so the editor still gets a useful highlight.
  const keys = path.split(".").reverse().map((part) =>
    part.replace(/\[\d+\]/g, "").replace(/^['"]|['"]$/g, ""),
  );
  for (const key of keys) {
    if (!key) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\s*(?:["']${escaped}["']|${escaped}):`);
    for (let line = 0; line < lines.length; line += 1) {
      const match = lines[line].match(pattern);
      if (!match) continue;
      return {
        start: { line, column: Math.max(0, match[0].search(/\S/)) },
        end: { line, column: lines[line].length },
      };
    }
  }
  return undefined;
}

/**
 * Tolerant parser for editor/playground use cases.
 */
export function parseForEditor(yaml: string): RelGeoDocument {
  return parseRelGeo(yaml, { mode: "editor" });
}

function normalizeHolesInObjects(objects: any) {
  if (objects && typeof objects === "object") {
    for (const id in objects) {
      const obj = objects[id];
      if (obj && typeof obj === "object" && Array.isArray(obj.holes)) {
        obj.holes = obj.holes.map((hole: any) => {
          if (hole && typeof hole === "object" && !Array.isArray(hole)) {
            const keys = Object.keys(hole);
            if (keys.length === 1) {
              const type = keys[0];
              const val = hole[type];
              const KNOWN_HOLE_TYPES = new Set(["circle", "rect", "polygon", "path", "segments", "clone"]);
              if (KNOWN_HOLE_TYPES.has(type)) {
                if (type === "segments") {
                  if (Array.isArray(val)) {
                    return { segments: val };
                  }
                  if (val && typeof val === "object") {
                    return val;
                  }
                } else if (val && typeof val === "object" && !Array.isArray(val)) {
                  return { type, ...val };
                }
              }
            }
          }
          return hole;
        });
      }
    }
  }
}

/**
 * Parses a RelGeo YAML string into a RelGeoDocument.
 * parseRelGeo() is strict by default.
 * Use parseForEditor() for tolerant playground/editor parsing.
 */
function parseRelGeoInternal(
  yaml: string,
  options: ParseOptions = {}
): RelGeoDocument & { objects: Record<string, RelGeoObject> } {
  const mode = options.mode || "validate"; // Default to validate for safety

  let doc: any;
  try {
    doc = load(yaml);
  } catch (e: any) {
    const mark = e?.mark;
    const range = mark && typeof mark.line === "number" && typeof mark.column === "number"
      ? {
          start: { line: mark.line, column: mark.column },
          end: { line: mark.line, column: mark.column + 1 },
        }
      : undefined;
    throw new ParseError(`YAML Parse Error: ${e.message}`, undefined, "INVALID_YAML", range);
  }

  if (!doc || typeof doc !== "object") {
    throw new ParseError("Invalid document structure: root must be an object");
  }

  // 1. Validate / Default Version
  if (doc.version === undefined) {
    doc.version = ACTIVE_REL_GEO_SPEC_VERSION;
  }
  if (typeof doc.version !== "number" && typeof doc.version !== "string") {
    throw new ParseError("Field 'version' must be a number or string", "version");
  }
  if (classifyRelGeoSpecVersion(doc.version) === "unsupported") {
    throw new ParseError(
      `Unsupported RelGeo DSL version "${normalizeRelGeoSpecVersion(doc.version)}". Supported public versions: ${SUPPORTED_REL_GEO_SPEC_VERSIONS.join(", ")}; regression-only versions: ${REGRESSION_ONLY_REL_GEO_SPEC_VERSIONS.join(", ")}.`,
      "version",
      "UNSUPPORTED_SPEC_VERSION",
    );
  }

  // 2. Validate Top-Level Fields
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      throw new ParseError(`Unknown top-level field: ${key}`, key);
    }
  }

  // 3. Validate / Default Objects
  if (doc.objects === undefined) {
    doc.objects = {};
  }
  if (typeof doc.objects !== "object" || Array.isArray(doc.objects)) {
    throw new ParseError("Invalid field: objects must be an object", "objects");
  }

  // 4. Normalize Parameter Shorthand (Optional, but good for UX)
  if (doc.parameters && typeof doc.parameters === "object") {
    for (const key in doc.parameters) {
      const val = doc.parameters[key];
      if (typeof val === "number" || typeof val === "string") {
        let paramType = "number";
        if (typeof val === "string") {
          if (/(?:deg|rad)$/i.test(val)) {
            paramType = "angle";
          } else if (/%$/.test(val)) {
            paramType = "percent";
          } else if (/[a-z]+$/i.test(val)) {
            paramType = "length";
          }
        }
        doc.parameters[key] = { 
          type: paramType, 
          default: val 
        };
      }
    }
  }

  // Normalize single-key polymorphic hole dictionary representations to standard type-objects
  normalizeHolesInObjects(doc.objects);
  if (doc.components && typeof doc.components === "object") {
    for (const compName in doc.components) {
      const comp = doc.components[compName];
      if (comp && typeof comp === "object") {
        normalizeHolesInObjects(comp.objects);
      }
    }
  }

  // 5. Inject IDs into objects and validate basic types
  for (const id in doc.objects) {
    const obj = doc.objects[id];
    if (!obj.type) {
      throw new ParseError(`Object "${id}" is missing required field: type`, `objects.${id}`);
    }
    if (!OBJECT_FIELDS[obj.type]) {
      throw new ParseError(`Invalid object type: ${obj.type}`, `objects.${id}.type`);
    }

    const allowedFields = new Set([...COMMON_OBJECT_FIELDS, ...OBJECT_FIELDS[obj.type]]);
    for (const field of Object.keys(obj)) {
      if (!allowedFields.has(field)) {
        throw new ParseError(`Unknown field "${field}" on object "${id}"`, `objects.${id}.${field}`);
      }
    }

    if (mode !== "editor") {
      if (obj.type === "rect" && (!Array.isArray(obj.size) || obj.size.length !== 2)) {
        throw new ParseError(`rect "${id}" requires size: [width, height]`, `objects.${id}.size`, "MISSING_REQUIRED_FIELD");
      }
      if (obj.type === "polygon" && (!Array.isArray(obj.points) || obj.points.length < 3)) {
        throw new ParseError(`polygon "${id}" requires at least 3 points`, `objects.${id}.points`, "MISSING_REQUIRED_FIELD");
      }
    }

    obj.id = id;
  }

  // 6. Semantic Validation
  if (mode !== "editor") {
    try {
      const validator = new Validator(doc as RelGeoDocument, mode);
      validator.validate();
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw new ParseError(error.message, error.path, error.code);
      }
      const rawMessage = error instanceof Error ? error.message : String(error);
      const prefix = rawMessage.match(/^([A-Z][A-Z0-9_]*):\s*/)?.[1];
      const code = normalizeErrorCode(error?.code ?? prefix, rawMessage, "INVALID_EXPRESSION");
      const message = stripErrorCodePrefix(rawMessage);
      throw new ParseError(message, error?.path, code);
    }
  }

  return doc as RelGeoDocument & { objects: Record<string, RelGeoObject> };
}

/** Public parser boundary: unexpected internals are still structured errors. */
export function parseRelGeo(
  yaml: string,
  options: ParseOptions = {},
): RelGeoDocument & { objects: Record<string, RelGeoObject> } {
  try {
    return parseRelGeoInternal(yaml, options);
  } catch (error) {
    if (error instanceof ParseError) {
      if (!error.range) error.range = sourceRangeForPath(yaml, error.path);
      throw error;
    }
    const candidate = error && typeof error === "object"
      ? error as { code?: unknown; path?: string; range?: SourceRange }
      : {};
    const rawMessage = error instanceof Error ? error.message : String(error);
    const code = normalizeErrorCode(candidate.code, rawMessage, "INVALID_YAML");
    throw new ParseError(
      stripErrorCodePrefix(rawMessage),
      candidate.path,
      code,
      candidate.range,
    );
  }
}
