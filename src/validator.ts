import type { RelGeoDocument, RelGeoErrorCode, RelGeoError, RelGeoMode, SourceRange } from "./types";
import { validateExpressionSyntax, evaluateExpression } from "./evaluator";
import { PLACE_FIELDS } from "./constants";
import { normalizeErrorCode, stripErrorCodePrefix } from "./errors";

const STANDARD_ANCHORS = new Set([
  "left", "right", "top", "bottom",
  "width", "height", "center", "centerX", "centerY",
  "x", "y", "cx", "cy", "r", "radius", "rx", "ry", "rotation", "perimeter",
  "start", "end", "length", "area", "through", "cp", "cp1", "cp2",
  "topLeft", "topRight", "bottomLeft", "bottomRight",
  "topCenter", "bottomCenter", "centerLeft", "centerRight",
]);

const TEXT_ANCHORS = new Set([
  "topLeft", "topCenter", "topRight",
  "centerLeft", "center", "centerRight",
  "bottomLeft", "bottomCenter", "bottomRight",
]);

const POINT_COMPONENTS = new Set(["x", "y"]);

const LINE_DIRECTIONS = new Set(["left", "right", "up", "down"]);
const MOVE_FIELDS = new Set(["angle", "distance", "left", "right", "up", "down", "x", "y"]);
const OFFSET_SIDES = new Set(["left", "right", "inside", "outside"]);
const MIRROR_AXES = new Set(["x", "y", "both"]);
const REPEAT_ALONG_SPACING = new Set(["uniform-length", "uniform-t", "fixed-distance"]);
const PATH_LIKE_OBJECT_TYPES = new Set(["line", "arc", "circle", "ellipse", "rect", "quadratic", "cubic", "path", "polygon"]);


const SCENE_UNITS = new Set(["mm", "cm", "m", "in", "px"]);
const SCENE_ORIENTATIONS = new Set(["y-down", "y-up"]);
const SCENE_ORIGINS = new Set(["top-left", "bottom-left", "center"]);

const POINT_RETURNING_ANCHORS: Record<string, Set<string>> = {
  point: new Set(["center"]),
  line: new Set(["start", "end", "center"]),
  rect: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "center"]),
  circle: new Set(["center", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  ellipse: new Set(["center", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  arc: new Set(["start", "end", "through", "center"]),
  quadratic: new Set(["start", "cp", "end", "center"]),
  cubic: new Set(["start", "cp1", "cp2", "end", "center"]),
  path: new Set(["start", "end", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "center"]),
  polygon: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "center"]),
  boolean: new Set(["start", "end", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "center"]),
  text: new Set(["topLeft", "topCenter", "topRight", "centerLeft", "center", "centerRight", "bottomLeft", "bottomCenter", "bottomRight"]),
  group: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center"]),
  clone: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center"]),
  translate: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
  rotate: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
  scale: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
  mirror: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
  reverse: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
  split: new Set(["topLeft", "topRight", "bottomLeft", "bottomRight", "center", "start", "end"]),
};

const OBJECT_ANCHORS: Record<string, Set<string>> = {
  point: new Set(["x", "y", "center"]),
  line: new Set(["start", "end", "center", "length"]),
  rect: new Set(["left", "right", "top", "bottom", "width", "height", "center", "centerX", "centerY", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "area"]),
  circle: new Set(["center", "left", "right", "top", "bottom", "centerX", "centerY", "radius", "r", "cx", "cy", "width", "height", "area", "x", "y", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  ellipse: new Set(["center", "left", "right", "top", "bottom", "centerX", "centerY", "cx", "cy", "rx", "ry", "rotation", "width", "height", "area", "perimeter", "x", "y", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  arc: new Set(["start", "end", "through", "center", "centerX", "centerY", "cx", "cy", "radius", "r", "left", "right", "top", "bottom", "width", "height", "length"]),
  quadratic: new Set(["start", "cp", "end", "center", "left", "right", "top", "bottom", "width", "height", "centerX", "centerY", "length"]),
  cubic: new Set(["start", "cp1", "cp2", "end", "center", "left", "right", "top", "bottom", "width", "height", "centerX", "centerY", "length"]),
  path: new Set(["start", "end", "center", "left", "right", "top", "bottom", "width", "height", "centerX", "centerY", "length", "area", "x", "y", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  polygon: new Set(["left", "right", "top", "bottom", "width", "height", "center", "centerX", "centerY", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight", "area", "x", "y"]),
  boolean: new Set(["start", "end", "center", "left", "right", "top", "bottom", "width", "height", "centerX", "centerY", "length", "area", "x", "y", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight"]),
  text: new Set(["left", "right", "top", "bottom", "center", "centerX", "centerY", "topLeft", "topCenter", "topRight", "centerLeft", "centerRight", "bottomLeft", "bottomCenter", "bottomRight", "x", "y"]),
  group: new Set(["left", "right", "top", "bottom", "width", "height", "center", "centerX", "centerY", "topLeft", "topRight", "bottomLeft", "bottomRight"]),
  clone: new Set(["left", "right", "top", "bottom", "width", "height", "center", "centerX", "centerY", "topLeft", "topRight", "bottomLeft", "bottomRight"]),
  translate: STANDARD_ANCHORS,
  rotate: STANDARD_ANCHORS,
  scale: STANDARD_ANCHORS,
  mirror: STANDARD_ANCHORS,
  reverse: STANDARD_ANCHORS,
  split: STANDARD_ANCHORS,
};

export class ValidationError extends Error implements RelGeoError {
  phase = "validate" as const;
  severity = "error" as const;
  range?: SourceRange;
  public code: RelGeoErrorCode;
  public path?: string;
  public objectId?: string;

  constructor(
    message: string,
    path?: string,
    code?: RelGeoErrorCode,
    objectId?: string,
    range?: SourceRange
  ) {
    const normalizedCode = normalizeErrorCode(code, message, "INVALID_VALUE");
    const fullMessage = `${normalizedCode}: ${stripErrorCodePrefix(message)}`;
    super(fullMessage);
    this.message = fullMessage;
    this.name = "ValidationError";
    this.code = normalizedCode;
    this.path = path;
    this.objectId = objectId;
    this.range = range;
  }
}

export class Validator {
  private knownIds: Set<string>;
  private objectIds: Set<string>;
  private valueIds: Set<string>;

  constructor(private doc: RelGeoDocument, private mode: RelGeoMode = "validate") {
    this.doc.objects = this.doc.objects || {};
    this.objectIds = new Set(Object.keys(doc.objects || {}));
    this.valueIds = new Set([
      ...Object.keys(doc.parameters || {}),
      ...Object.keys(doc.constants || {}),
      ...Object.keys(doc.derived || {}),
    ]);
    this.knownIds = new Set([...this.objectIds, ...this.valueIds]);
  }

  validate(): void {
    try {
      this.validateInternal();
    } catch (error) {
      if (error instanceof ValidationError) throw error;

      const candidate = (error && typeof error === "object" ? error : {}) as {
        code?: string;
        path?: string;
        objectId?: string;
      };
      const rawMessage = error instanceof Error ? error.message : String(error);
      const prefix = rawMessage.match(/^([A-Z][A-Z0-9_]*):\s*/)?.[1];
      const code = normalizeErrorCode(candidate.code ?? prefix, rawMessage, "INVALID_EXPRESSION");
      const message = stripErrorCodePrefix(rawMessage);
      throw new ValidationError(message, candidate.path, code, candidate.objectId);
    }
  }

  private validateInternal(): void {
    this.validateIdentifiers();
    this.validateParameters();
    this.validateExpressions();
    this.validateConstraints();
    this.validateScene();
    this.validateSheetsAndViews();

    if (this.doc.components) {
      for (const [compId, compDef] of Object.entries(this.doc.components)) {
        const compDoc: RelGeoDocument = {
          version: this.doc.version,
          parameters: compDef.parameters || {},
          derived: compDef.derived || {},
          objects: compDef.objects || {},
        };
        const compValidator = new Validator(compDoc, this.mode);
        compValidator.knownIds = new Set([...compValidator.knownIds, ...this.knownIds]);
        compValidator.objectIds = new Set([...compValidator.objectIds, ...this.objectIds]);
        compValidator.validate();

        if (compDef.exports) {
          for (const [key, expr] of Object.entries(compDef.exports)) {
            if (typeof expr === "string") {
              try {
                validateExpressionSyntax(expr);
                const mockCtx = {
                  scalars: {},
                  targetUnit: "px" as const,
                  objects: new Proxy({}, {
                    get: (target, name: string) => {
                      const innerObj = compValidator.doc.objects?.[name];
                      if (innerObj) {
                        return { type: innerObj.type };
                      }
                      const globalObj = this.doc.objects?.[name];
                      if (globalObj) {
                        return { type: globalObj.type };
                      }
                      return undefined;
                    }
                  }),
                  resolveIdentifier: (name: string) => {
                    if (compValidator.isValidObjectReference(name) || this.isValidObjectReference(name)) return 1;
                    throw new Error(`Unknown identifier: ${name}`);
                  },
                  get: (name: string) => {
                    const innerObj = compValidator.doc.objects?.[name];
                    if (innerObj) {
                      return { type: "object", value: { type: innerObj.type } };
                    }
                    const globalObj = this.doc.objects?.[name];
                    if (globalObj) {
                      return { type: "object", value: { type: globalObj.type } };
                    }
                    if (compValidator.isValidObjectReference(name) || this.isValidObjectReference(name)) {
                      return { type: "number", value: 1 };
                    }
                    return undefined;
                  },
                  getMember: (obj: any, member: string) => {
                    const objVal = obj.value || obj;
                    const objType = objVal?.type;
                    if (objType) {
                      const anchors = OBJECT_ANCHORS[objType];
                      if (anchors && !anchors.has(member)) {
                        throw new Error(`Unknown member "${member}" on type "${objType}"`);
                      }
                    }
                    return { type: "number", value: 1 };
                  },
                  getIndex: (arr: any, index: any) => {
                    return { type: "number", value: 1 };
                  },
                  callFunction: (name: string, args: any[]) => {
                    if (["count", "first", "last"].includes(name)) {
                      return { type: "number", value: 1 };
                    }
                    return undefined;
                  }
                };
                evaluateExpression(expr, mockCtx as any, { allowUnknownIdentifiers: true, allowUnknownGeometryObjects: true });
              } catch (e: any) {
                if (this.mode !== "editor") {
                  throw new ValidationError(`Invalid export expression "${key}": ${stripErrorCodePrefix(e.message)}`, `components.${compId}.exports.${key}`, "INVALID_EXPRESSION");
                }
              }
            }
          }
        }
      }
    }
  }

  private isEffectivelyClosedPath(obj: any): boolean {
    if (!obj) return false;
    if (obj.type === "boolean" || obj.type === "polygon" || obj.type === "rect" || obj.type === "circle" || obj.type === "ellipse") return true;
    if (obj.type !== "path") return false;
    if (obj.closed) return true;
    if (obj.offset?.from) {
      const source = this.doc.objects?.[obj.offset.from];
      if (!source) return false;
      if (source.type === "polygon") return true;
      if (source.type === "path") return !!source.closed;
    }
    return false;
  }

  private isValidObjectReference(name: string): boolean {
    if (name === "origin") return true;
    if (this.knownIds.has(name) || this.objectIds.has(name)) return true;

    if (!name.includes(".")) {
      return false;
    }

    const parts = name.split(".");
    const base = parts[0];
    if (!this.objectIds.has(base)) {
      return false;
    }

    let currentType: string | "point-component" | "scalar" = this.doc.objects![base].type;
    const rawObj: any = this.doc.objects![base];

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];

      if (currentType === "point-component" || currentType === "scalar") {
        return false;
      }

      if (part === "holes") {
        currentType = "holes-list";
        continue;
      }

      if (currentType === "component") {
        const compName = rawObj?.use;
        const compDef = this.doc.components?.[compName];
        if (!compDef) {
          return false;
        }
        if (compDef.exports && Object.keys(compDef.exports).length > 0) {
          if (compDef.exports[part] !== undefined) {
            currentType = "point";
            continue;
          } else {
            return false;
          }
        } else {
          if (compDef.objects?.[part] !== undefined) {
            const innerObj = compDef.objects[part];
            currentType = innerObj.type;
            continue;
          } else {
            return false;
          }
        }
      }

      const objectAnchors = OBJECT_ANCHORS[currentType] || new Set<string>();
      let customAnchorExists = i === 1 && rawObj?.anchors && rawObj.anchors[part];
      if (
        !customAnchorExists &&
        i === 1 &&
        (rawObj?.type === "clone" ||
          rawObj?.type === "translate" ||
          rawObj?.type === "rotate" ||
          rawObj?.type === "scale" ||
          rawObj?.type === "mirror" ||
          rawObj?.type === "reverse" ||
          rawObj?.type === "split")
      ) {
        const sourceId = rawObj.of ?? rawObj.target;
        const source = this.doc.objects?.[sourceId];
        if (source && (source as any).anchors && (source as any).anchors[part]) {
          customAnchorExists = true;
        }
      }
      if (!objectAnchors.has(part) && !customAnchorExists) {
        return false;
      }

      if (currentType === "path" && part === "area" && !this.isEffectivelyClosedPath(rawObj)) {
        return false;
      }

      if ((POINT_RETURNING_ANCHORS[currentType] || new Set<string>()).has(part) || customAnchorExists) {
        currentType = "point-component";
      } else {
        currentType = "scalar";
      }

      if (currentType === "point-component" && i < parts.length - 1) {
        const next = parts[i + 1];
        if (!POINT_COMPONENTS.has(next)) {
          return false;
        }
        currentType = "scalar";
        i += 1;
      }
    }

    return true;
  }

  private validateIdentifiers(): void {
    const allIds = new Map<string, string>();

    const check = (id: string, type: string) => {
      if (allIds.has(id)) {
        throw new ValidationError(`Duplicate identifier "${id}" found in both ${allIds.get(id)} and ${type}`, `${type}.${id}`);
      }
      allIds.set(id, type);
    };

    Object.keys(this.doc.parameters || {}).forEach(id => check(id, "parameters"));
    Object.keys(this.doc.constants || {}).forEach(id => check(id, "constants"));
    Object.keys(this.doc.derived || {}).forEach(id => check(id, "derived"));
    Object.keys(this.doc.objects || {}).forEach(id => check(id, "objects"));
  }

  private validateExpressions(): void {
    const validateExpr = (expr: any, path: string) => {
      if (typeof expr !== "string") return;

      try {
        validateExpressionSyntax(expr);
        const matches = expr.match(/([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+)/g);
        if (matches) {
          for (const match of matches) {
            const base = match.split(".")[0];
            if (this.objectIds.has(base) && !this.isValidObjectReference(match)) {
              const parts = match.split(".");
              const invalidPart = parts[1];
              if (this.objectIds.has(base)) {
                const baseObj = this.doc.objects![base];
                if (baseObj && baseObj.type === "component") {
                  throw new Error(`Unknown anchor: ${invalidPart} on component ${base}`);
                }
                throw new Error(`Unknown anchor: ${invalidPart} on object ${base}`);
              }
              throw new Error(`Invalid object reference: ${match}`);
            }
          }
        }
        // Check for unknown identifiers
        const evalCtx = {
          scalars: {},
          targetUnit: "px" as const,
          // Proxy objects to satisfy geometry functions during validation
          objects: new Proxy({}, {
            get: (target, name: string) => {
              if (this.objectIds.has(name)) {
                const obj = this.doc.objects![name];
                // Use name seed to create unique dummy lines/shapes to avoid parallel issues
                const seed = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
                return { 
                  type: obj.type, 
                  x1: 0, y1: 0, x2: seed, y2: 100, 
                  cx: 0, cy: 0, radius: 10, 
                  x: 0, y: 0, width: 10, height: 10 
                };
              }
              return undefined;
            }
          }),
          resolveIdentifier: (name: string) => {
            if (this.isValidObjectReference(name)) return 1;
            
            // Allow unknown identifiers without throwing IF it's an anchor field 
            // e.g. path ends with .anchor or .origin or path includes .place.
            if (path.endsWith('.anchor') || path.endsWith('.origin') || path.includes('.place.')) {
                return undefined;
            }

            if (!name.includes(".")) {
              throw new Error(`Unknown identifier: ${name}`);
            }
            const [base, anchor] = name.split(".");
            if (this.objectIds.has(base)) {
              throw new Error(`Unknown anchor: ${anchor} on object ${base}`);
            }
            throw new Error(`Unknown identifier: ${name}`);
          },
          get: (name: string) => {
            if (this.objectIds.has(name)) {
              return { type: "object" as const, value: { type: this.doc.objects![name].type, id: name } };
            }
            if (this.isValidObjectReference(name)) {
              return { type: "number" as const, value: 1 };
            }
            return undefined;
          },
          getMember: (obj: any, member: string) => {
            const type = obj.value?.type || obj.type;
            const id = obj.value?.id;
            
            // Check custom anchors first
            if (id) {
              if (member === "holes") {
                return { type: "array" as const, value: { type: "holes-list" as const, id } };
              }
              const rawObj = this.doc.objects![id];
              let customAnchorExists = !!(rawObj?.anchors && rawObj.anchors[member]);
              if (
                !customAnchorExists &&
                (rawObj?.type === "clone" ||
                  rawObj?.type === "translate" ||
                  rawObj?.type === "rotate" ||
                  rawObj?.type === "scale" ||
                  rawObj?.type === "mirror" ||
                  rawObj?.type === "reverse" ||
                  rawObj?.type === "split")
              ) {
                const sourceId =
                  rawObj.type === "clone"
                    ? rawObj.of
                    : rawObj.target;
                const source = this.doc.objects?.[sourceId];
                if (source && (source as any).anchors && (source as any).anchors[member]) {
                  customAnchorExists = true;
                }
              }
              if (customAnchorExists) {
                return { type: "point" as const, value: { x: 0, y: 0 } };
              }
            }

            if (type && OBJECT_ANCHORS[type]) {
              if (OBJECT_ANCHORS[type].has(member)) {
                if ((type === "path" || type === "boolean") && member === "area" && id) {
                  const rawObj = this.doc.objects![id];
                  if (rawObj && !this.isEffectivelyClosedPath(rawObj)) {
                    throw new Error("area is only available on closed path");
                  }
                }
                if (POINT_RETURNING_ANCHORS[type]?.has(member)) {
                  return { type: "point" as const, value: { x: 0, y: 0 } };
                }
                return { type: "number" as const, value: 1 };
              }
              throw new Error(`Unknown anchor: ${member} on object`);
            }
            if ((obj.type === "point" || (obj.value && obj.value.type === "point"))) {
              if (POINT_COMPONENTS.has(member)) {
                return { type: "number" as const, value: 1 };
              }
              throw new Error(`Unknown anchor: ${member} on point`);
            }
            return { type: "number" as const, value: 1 };
          },
          getIndex: (arr: any, index: any) => {
            const arrVal = arr.value;
            if (arrVal?.type === "holes-list" || arr.type === "holes-list") {
              return { type: "object" as const, value: { type: "path" as const, id: arrVal?.id } };
            }
            return { type: "number" as const, value: 1 };
          },
          callFunction: (name: string, args: any[]) => {
            if (["count", "first", "last"].includes(name)) {
              if (name === "first" || name === "last") {
                // If it is a collection type, return a generic mock object
                const arg = args[0];
                const argVal = arg?.value;
                if (arg?.type === "object" && argVal) {
                  return { type: "object" as const, value: argVal };
                }
                return { type: "object" as const, value: { type: "point" as const } };
              }
              return { type: "number" as const, value: 1 };
            }
            return undefined;
          }
        };
        evaluateExpression(expr, evalCtx, { 
          allowUnknownIdentifiers: true,
          allowUnknownGeometryObjects: true 
        });
      } catch (error: any) {
        if (this.mode !== "editor") {
            throw new ValidationError(`Invalid expression syntax: ${stripErrorCodePrefix(error.message)}`, path, "INVALID_EXPRESSION");
        }
      }
    };

    for (const [id, der] of Object.entries<any>(this.doc.derived || {})) {
      validateExpr(der.value, `derived.${id}.value`);
    }

    for (const [id, obj] of Object.entries<any>(this.doc.objects || {})) {
      const path = `objects.${id}`;
      if (obj.type !== "point" && obj.type !== "line" && obj.type !== "repeat" && obj.type !== "divide" && obj.type !== "collection") {
        if (obj.place && obj.on) {
          throw new ValidationError(`Cannot use both "place" and "on" constraints on the same object`, path, "OVER_CONSTRAINED");
        }
        if (obj.on) {
          this.validateOn(obj.on, path, validateExpr);
        }
      }

      if (obj.type === "point") {
        validateExpr(obj.at, `${path}.at`);
        if (Array.isArray(obj.at) && obj.at.length === 2) {
          validateExpr(obj.at[0], `${path}.at[0]`);
          validateExpr(obj.at[1], `${path}.at[1]`);
        }
        validateExpr(obj.from, `${path}.from`);
        if (obj.move) {
          if (this.mode !== "editor") {
            for (const key of Object.keys(obj.move)) {
              if (!MOVE_FIELDS.has(key)) {
                throw new ValidationError(`Unknown field "${key}" in point.move`, `${path}.move.${key}`, "UNKNOWN_FIELD");
              }
            }
          }
          validateExpr(obj.move.angle, `${path}.move.angle`);
          validateExpr(obj.move.distance, `${path}.move.distance`);
          validateExpr(obj.move.x, `${path}.move.x`);
          validateExpr(obj.move.y, `${path}.move.y`);
        }
        if (obj.on) {
          this.validateOn(obj.on, path, validateExpr);
        }
        if (obj.pointShape !== undefined) {
          validateExpr(obj.pointShape, `${path}.pointShape`);
        }
        if (obj.color !== undefined) {
          validateExpr(obj.color, `${path}.color`);
        }
      } else if (obj.type === "line") {
        if (this.mode !== "editor") {
          const hasTo = obj.to !== undefined;
          const hasDirLen = obj.direction !== undefined || obj.length !== undefined;
          const hasTangent = obj.tangent !== undefined;

          if (!hasTangent && obj.from === undefined) {
            throw new ValidationError(`line "${id}" requires "from"`, path, "MISSING_REQUIRED_FIELD");
          }

          const activeModes = [hasTo, hasDirLen, hasTangent].filter(Boolean).length;
          if (activeModes > 1) {
            if (!hasTangent && hasTo && hasDirLen) {
              throw new ValidationError(`line "${id}" cannot use both "to" and "direction/length"`, path, "OVER_CONSTRAINED");
            }
            throw new ValidationError(`line "${id}" cannot combine "to", "direction/length", and "tangent" modes`, path, "OVER_CONSTRAINED");
          }
          if (activeModes === 0) {
            throw new ValidationError(`line "${id}" requires either "to" or "direction/length" or "tangent"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasDirLen && (obj.direction === undefined || obj.length === undefined)) {
            throw new ValidationError(`line "${id}" requires both "direction" and "length" when using vector mode`, path, "MISSING_REQUIRED_FIELD");
          }
          if (obj.direction !== undefined && !LINE_DIRECTIONS.has(obj.direction)) {
            throw new ValidationError(`Invalid direction: ${obj.direction}. Expected one of: left, right, up, down`, `${path}.direction`, "INVALID_VALUE");
          }
          if (hasTangent) {
            if (!obj.tangent.from || !obj.tangent.to) {
              throw new ValidationError(`line "${id}" tangent mode requires "from" and "to"`, `${path}.tangent`, "MISSING_REQUIRED_FIELD");
            }
            const tangentTarget = this.doc.objects?.[obj.tangent.to];
            if (!tangentTarget) {
              throw new ValidationError(`Unknown reference: ${obj.tangent.to}`, `${path}.tangent.to`, "UNKNOWN_REFERENCE");
            }
            if (!["circle", "arc"].includes(tangentTarget.type)) {
              throw new ValidationError(`line "${id}" tangent target must be circle or arc`, `${path}.tangent.to`, "TYPE_MISMATCH");
            }
          }
        }

        validateExpr(obj.from, `${path}.from`);
        validateExpr(obj.to, `${path}.to`);
        validateExpr(obj.length, `${path}.length`);
        if (obj.tangent) {
          validateExpr(obj.tangent.from, `${path}.tangent.from`);
        }
      } else if (obj.type === "rect") {
        if (this.mode !== "editor" && obj.size === undefined) {
          throw new ValidationError(`rect "${id}" requires "size"`, path, "MISSING_REQUIRED_FIELD");
        }
        validateExpr(obj.size?.[0], `${path}.size[0]`);
        validateExpr(obj.size?.[1], `${path}.size[1]`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (Array.isArray(obj.holes)) {
          this.validateClosedShapeHoles(obj.holes, path, validateExpr);
        }
      } else if (obj.type === "circle") {
        if (this.mode !== "editor") {
          const hasCenter = obj.center !== undefined;
          const hasPlace = obj.place !== undefined;
          const hasRadius = obj.radius !== undefined;
          const hasThrough = obj.through !== undefined;

          if (hasCenter && hasPlace) {
            throw new ValidationError(`Circle "${id}" cannot use both center and place`, path, "OVER_CONSTRAINED");
          }
          if (!hasCenter && !hasPlace) {
            throw new ValidationError(`Circle "${id}" requires either "center" or "place"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasRadius && hasThrough) {
            throw new ValidationError(`Circle "${id}" cannot use both "radius" and "through"`, path, "OVER_CONSTRAINED");
          }
          if (!hasRadius && !hasThrough) {
            throw new ValidationError(`Circle "${id}" requires either "radius" or "through"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasThrough && hasPlace) {
            throw new ValidationError(`Circle "${id}" cannot use "through" with "place". Use "center" and "through" for deterministic radius calculation.`, path, "UNSUPPORTED_FEATURE");
          }
        }
        validateExpr(obj.center, `${path}.center`);
        validateExpr(obj.radius, `${path}.radius`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (Array.isArray(obj.holes)) {
          this.validateClosedShapeHoles(obj.holes, path, validateExpr);
        }
      } else if (obj.type === "ellipse") {
        if (this.mode !== "editor") {
          const hasCenter = obj.center !== undefined;
          const hasPlace = obj.place !== undefined;
          const hasSize = Array.isArray(obj.size);
          const hasRx = obj.rx !== undefined;
          const hasRy = obj.ry !== undefined;

          if (hasCenter && hasPlace) {
            throw new ValidationError(`ellipse "${id}" cannot use both center and place`, path, "OVER_CONSTRAINED");
          }
          if (!hasCenter && !hasPlace) {
            throw new ValidationError(`ellipse "${id}" requires either "center" or "place"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasSize && (hasRx || hasRy)) {
            throw new ValidationError(`ellipse "${id}" cannot combine "size" with "rx"/"ry"`, path, "ELLIPSE_SIZE_CONFLICT");
          }
          if (!hasSize && (!hasRx || !hasRy)) {
            throw new ValidationError(`ellipse "${id}" requires either "size" or both "rx" and "ry"`, path, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.center, `${path}.center`);
        validateExpr(obj.rx, `${path}.rx`);
        validateExpr(obj.ry, `${path}.ry`);
        validateExpr(obj.size?.[0], `${path}.size[0]`);
        validateExpr(obj.size?.[1], `${path}.size[1]`);
        validateExpr(obj.rotation, `${path}.rotation`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (Array.isArray(obj.holes)) {
          this.validateClosedShapeHoles(obj.holes, path, validateExpr);
        }
      } else if (obj.type === "text") {
        if (this.mode !== "editor") {
          if (obj.content === undefined) {
            throw new ValidationError(`text "${id}" requires "content"`, path, "MISSING_REQUIRED_FIELD");
          }
          const hasAt = obj.at !== undefined;
          const hasPlace = obj.place !== undefined;
          if (hasAt && hasPlace) {
            throw new ValidationError(`text "${id}" cannot use both at and place`, path, "OVER_CONSTRAINED");
          }
          if (!hasAt && !hasPlace) {
            throw new ValidationError(`text "${id}" requires either "at" or "place"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (obj.anchor !== undefined && !TEXT_ANCHORS.has(obj.anchor)) {
            throw new ValidationError(`text "${id}" has invalid anchor: ${obj.anchor}`, `${path}.anchor`, "TYPE_MISMATCH");
          }
        }
        validateExpr(obj.at, `${path}.at`);
        if (typeof obj.content === "string") {
          const matches = obj.content.matchAll(/\{([^{}]+)\}/g);
          for (const m of matches) {
            validateExpr(m[1].trim(), `${path}.content`);
          }
        } else {
          validateExpr(obj.content, `${path}.content`);
        }
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
      } else if (obj.type === "arc") {
        if (this.mode !== "editor") {
          const hasThreePoint = obj.from !== undefined || obj.through !== undefined || obj.to !== undefined;
          const hasCenterMode =
            obj.center !== undefined ||
            obj.radius !== undefined ||
            obj.startAngle !== undefined ||
            obj.endAngle !== undefined;

          if (hasThreePoint && hasCenterMode) {
            throw new ValidationError(`arc "${id}" cannot combine 3-point mode with center-radius mode`, path, "OVER_CONSTRAINED");
          }
          if (!hasThreePoint && !hasCenterMode) {
            throw new ValidationError(`arc "${id}" requires either 3-point mode or center-radius mode`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasThreePoint && (obj.from === undefined || obj.through === undefined || obj.to === undefined)) {
            throw new ValidationError(`arc "${id}" 3-point mode requires "from", "through", and "to"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (hasCenterMode && (obj.center === undefined || obj.radius === undefined || obj.startAngle === undefined || obj.endAngle === undefined)) {
            throw new ValidationError(`arc "${id}" center-radius mode requires "center", "radius", "startAngle", and "endAngle"`, path, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.from, `${path}.from`);
        validateExpr(obj.through, `${path}.through`);
        validateExpr(obj.to, `${path}.to`);
        validateExpr(obj.center, `${path}.center`);
        validateExpr(obj.radius, `${path}.radius`);
        validateExpr(obj.startAngle, `${path}.startAngle`);
        validateExpr(obj.endAngle, `${path}.endAngle`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
      } else if (obj.type === "cubic") {
        if (this.mode !== "editor") {
          if (obj.from === undefined || obj.cp1 === undefined || obj.cp2 === undefined || obj.to === undefined) {
            throw new ValidationError(`cubic "${id}" requires "from", "cp1", "cp2", and "to"`, path, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.from, `${path}.from`);
        validateExpr(obj.cp1, `${path}.cp1`);
        validateExpr(obj.cp2, `${path}.cp2`);
        validateExpr(obj.to, `${path}.to`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
      } else if (obj.type === "quadratic") {
        if (this.mode !== "editor") {
          if (obj.from === undefined || obj.cp === undefined || obj.to === undefined) {
            throw new ValidationError(`quadratic "${id}" requires "from", "cp", and "to"`, path, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.from, `${path}.from`);
        validateExpr(obj.cp, `${path}.cp`);
        validateExpr(obj.to, `${path}.to`);
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
      } else if (obj.type === "path") {
        if (this.mode !== "editor") {
          const hasPoints = Array.isArray(obj.points);
          const hasSegments = Array.isArray(obj.segments);
          const hasJoin = Array.isArray((obj as any).join);
          const hasOffset = obj.offset !== undefined;
          const activeModes = [hasPoints, hasSegments, hasJoin, hasOffset].filter(Boolean).length;

          if (activeModes === 0) {
            throw new ValidationError(`path "${id}" requires one of: "points", "segments", "join", or "offset"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (activeModes > 1) {
            throw new ValidationError(`path "${id}" cannot combine "points", "segments", "join", and "offset" modes`, path, "OVER_CONSTRAINED");
          }
          if (hasPoints && obj.points.length < 2) {
            throw new ValidationError(`path "${id}" requires at least 2 points`, `${path}.points`, "MISSING_REQUIRED_FIELD");
          }
          if (hasSegments && obj.segments.length < 1) {
            throw new ValidationError(`path "${id}" requires at least 1 segment`, `${path}.segments`, "MISSING_REQUIRED_FIELD");
          }
          if (hasJoin && (obj as any).join.length < 1) {
            throw new ValidationError(`path "${id}" requires at least 1 join item`, `${path}.join`, "MISSING_REQUIRED_FIELD");
          }
          if (hasOffset) {
            if (!obj.offset.from || obj.offset.distance === undefined) {
              throw new ValidationError(`path "${id}" offset mode requires "from" and "distance"`, `${path}.offset`, "MISSING_REQUIRED_FIELD");
            }
          }
          if ((obj as any).closeWith !== undefined) {
            if (!hasJoin || obj.closed !== true) {
              throw new ValidationError(`path "${id}" closeWith is only valid on closed join paths`, `${path}.closeWith`, "INVALID_CLOSE_WITH");
            }
            if ((obj as any).closeWith !== "none" && (obj as any).closeWith !== "line") {
              throw new ValidationError(`Invalid closeWith value: ${(obj as any).closeWith}. Expected "none" or "line"`, `${path}.closeWith`, "INVALID_CLOSE_WITH");
            }
          }
          if (Array.isArray(obj.holes)) {
            if (!obj.closed) {
              throw new ValidationError(`path "${id}" with holes must be "closed: true"`, path, "INVALID_CONSTRAINT");
            }
          }
        }
        if (Array.isArray(obj.points)) {
          obj.points.forEach((pt: any, i: number) => {
            validateExpr(pt, `${path}.points[${i}]`);
          });
        }
        if (Array.isArray(obj.segments)) {
          this.validatePathSegments(obj.segments, `${path}.segments`, validateExpr);
        }
        if (Array.isArray((obj as any).join)) {
          (obj as any).join.forEach((ref: any, i: number) => validateExpr(ref, `${path}.join[${i}]`));
        }
        if (Array.isArray(obj.holes)) {
          this.validateClosedShapeHoles(obj.holes, path, validateExpr);
        }
        if (obj.offset) {
          if (this.mode !== "editor") {
            if (obj.offset.side !== undefined && !OFFSET_SIDES.has(obj.offset.side)) {
              throw new ValidationError(`Invalid offset side: ${obj.offset.side}. Expected one of: left, right, inside, outside`, `${path}.offset.side`, "INVALID_VALUE");
            }
          }
          validateExpr(obj.offset.from, `${path}.offset.from`);
          validateExpr(obj.offset.distance, `${path}.offset.distance`);
        }
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
      } else if (obj.type === "polygon") {
        if (this.mode !== "editor") {
          if (!Array.isArray(obj.points) || obj.points.length < 3) {
            throw new ValidationError(`polygon "${id}" requires at least 3 points`, `${path}.points`, "MISSING_REQUIRED_FIELD");
          }
        }
        if (Array.isArray(obj.points)) {
          obj.points.forEach((pt: any, i: number) => validateExpr(pt, `${path}.points[${i}]`));
        }
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
        if (Array.isArray(obj.holes)) {
          this.validateClosedShapeHoles(obj.holes, path, validateExpr);
        }
      } else if (obj.type === "group") {
        if (obj.place) {
          this.validatePlace(obj.place, path, validateExpr);
        }
        if (obj.transform) {
          this.validateTransform(obj.transform, path, validateExpr);
        }
      } else if (obj.type === "translate") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`translate "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
          if (!Array.isArray(obj.by) || obj.by.length !== 2) {
            throw new ValidationError(`translate "${id}" requires "by" as [x, y]`, `${path}.by`, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.target, `${path}.target`);
        if (Array.isArray(obj.by)) {
          validateExpr(obj.by[0], `${path}.by[0]`);
          validateExpr(obj.by[1], `${path}.by[1]`);
        }
      } else if (obj.type === "rotate") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`rotate "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
          if (obj.angle === undefined) {
            throw new ValidationError(`rotate "${id}" requires "angle"`, `${path}.angle`, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.target, `${path}.target`);
        validateExpr(obj.angle, `${path}.angle`);
        if (obj.origin !== undefined) {
          validateExpr(obj.origin, `${path}.origin`);
        }
      } else if (obj.type === "scale") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`scale "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
          if (obj.factor === undefined) {
            throw new ValidationError(`scale "${id}" requires "factor"`, `${path}.factor`, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.target, `${path}.target`);
        if (Array.isArray(obj.factor)) {
          if (obj.factor.length !== 2) {
            throw new ValidationError(`scale "${id}" factor must be [sx, sy]`, `${path}.factor`, "INVALID_VALUE");
          }
          validateExpr(obj.factor[0], `${path}.factor[0]`);
          validateExpr(obj.factor[1], `${path}.factor[1]`);
        } else {
          validateExpr(obj.factor, `${path}.factor`);
        }
        if (obj.origin !== undefined) {
          validateExpr(obj.origin, `${path}.origin`);
        }
      } else if (obj.type === "mirror") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`mirror "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
          if (!obj.axis) {
            throw new ValidationError(`mirror "${id}" requires "axis"`, `${path}.axis`, "MISSING_REQUIRED_FIELD");
          }
          if (!["x", "y", "both"].includes(obj.axis)) {
            throw new ValidationError(`Invalid mirror axis: ${obj.axis}. Expected "x", "y", or "both"`, `${path}.axis`, "INVALID_VALUE");
          }
        }
        validateExpr(obj.target, `${path}.target`);
        if (obj.origin !== undefined) {
          validateExpr(obj.origin, `${path}.origin`);
        }
      } else if (obj.type === "reverse") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`reverse "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
        }
        validateExpr(obj.target, `${path}.target`);
      } else if (obj.type === "split") {
        if (this.mode !== "editor") {
          if (!obj.target) {
            throw new ValidationError(`split "${id}" requires "target"`, `${path}.target`, "MISSING_REQUIRED_FIELD");
          }
          if (obj.at === undefined) {
            throw new ValidationError(`split "${id}" requires "at"`, `${path}.at`, "MISSING_REQUIRED_FIELD");
          }
          if (obj.pick !== undefined && obj.pick !== "first" && obj.pick !== "last") {
            throw new ValidationError(`split "${id}" pick must be "first" or "last"`, `${path}.pick`, "INVALID_VALUE");
          }
        }
        validateExpr(obj.target, `${path}.target`);
        validateExpr(obj.at, `${path}.at`);
      } else if (obj.type === "component") {
        if (this.mode !== "editor") {
          if (!obj.use) {
            throw new ValidationError(`component instance "${id}" requires "use"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (!this.doc.components || !this.doc.components[obj.use]) {
            throw new ValidationError(`component "${obj.use}" not found`, `${path}.use`, "COMPONENT_NOT_FOUND");
          }
        }
        if (obj.params) {
          for (const [paramName, paramVal] of Object.entries(obj.params)) {
            validateExpr(paramVal, `${path}.params.${paramName}`);
          }
        }
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (obj.transform) this.validateTransform(obj.transform, path, validateExpr);
      } else if (obj.type === "dimension") {
        if (this.mode !== "editor") {
          if (!obj.kind) {
            throw new ValidationError(`dimension "${id}" requires "kind"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (!["linear", "radius", "diameter", "angle"].includes(obj.kind)) {
            throw new ValidationError(`dimension "${id}" invalid kind: ${obj.kind}`, `${path}.kind`, "INVALID_VALUE");
          }
          if (obj.kind === "linear") {
            if (obj.from === undefined || obj.to === undefined) {
              throw new ValidationError(`linear dimension "${id}" requires "from" and "to"`, path, "MISSING_REQUIRED_FIELD");
            }
          } else if (obj.kind === "radius" || obj.kind === "diameter") {
            if (obj.target === undefined) {
              throw new ValidationError(`${obj.kind} dimension "${id}" requires "target"`, path, "MISSING_REQUIRED_FIELD");
            }
          } else if (obj.kind === "angle") {
            if (obj.between === undefined || !Array.isArray(obj.between) || obj.between.length !== 2) {
              throw new ValidationError(`angle dimension "${id}" requires "between" with exactly 2 lines`, path, "MISSING_REQUIRED_FIELD");
            }
          }
        }
        const validateDimExpr = (expr: any, subpath: string) => {
          if (expr === undefined) return;
          try {
            validateExpr(expr, subpath);
          } catch (e: any) {
            throw new ValidationError(stripErrorCodePrefix(e.message), subpath, "DIMENSION_TARGET_INVALID");
          }
        };
        validateDimExpr(obj.from, `${path}.from`);
        validateDimExpr(obj.to, `${path}.to`);
        validateDimExpr(obj.offset, `${path}.offset`);
        validateDimExpr(obj.target, `${path}.target`);
        if (Array.isArray(obj.between)) {
          obj.between.forEach((b: any, index: number) => {
            validateDimExpr(b, `${path}.between[${index}]`);
          });
        }
        if (typeof obj.text === "string") {
          const matches = obj.text.matchAll(/\{([^{}]+)\}/g);
          for (const m of matches) {
            const exprStr = m[1].trim();
            if (exprStr !== "distance" && exprStr !== "radius" && exprStr !== "diameter" && exprStr !== "angle") {
              validateDimExpr(exprStr, `${path}.text`);
            }
          }
        }
      } else if (obj.type === "annotation") {
        if (this.mode !== "editor") {
          if (obj.text === undefined) {
            throw new ValidationError(`annotation "${id}" requires "text"`, path, "MISSING_REQUIRED_FIELD");
          }
        }
        const validateAnnExpr = (expr: any, subpath: string) => {
          if (expr === undefined) return;
          try {
            validateExpr(expr, subpath);
          } catch (e: any) {
            throw new ValidationError(stripErrorCodePrefix(e.message), subpath, "ANNOTATION_TARGET_INVALID");
          }
        };
        validateAnnExpr(obj.target, `${path}.target`);
        if (obj.leader) {
          validateAnnExpr(obj.leader.from, `${path}.leader.from`);
          validateAnnExpr(obj.leader.to, `${path}.leader.to`);
        }
        if (obj.place) this.validatePlace(obj.place, path, validateExpr);
        if (typeof obj.text === "string") {
          const matches = obj.text.matchAll(/\{([^{}]+)\}/g);
          for (const m of matches) {
            const exprStr = m[1].trim();
            if (exprStr !== "distance" && exprStr !== "radius" && exprStr !== "diameter" && exprStr !== "angle") {
              validateAnnExpr(exprStr, `${path}.text`);
            }
          }
        }
      } else if (obj.type === "repeat") {
        if (this.mode !== "editor") {
          if (obj.item === undefined) {
            throw new ValidationError(`repeat "${id}" requires "item"`, path, "MISSING_REQUIRED_FIELD");
          }
          const hasCount = obj.count !== undefined;
          const hasGrid = obj.grid !== undefined;
          const hasPolar = obj.polar !== undefined;
          const hasEach = obj.each !== undefined;
          const hasAlong = (obj as any).along !== undefined;
          const modes = [hasCount, hasGrid, hasPolar, hasEach, hasAlong].filter(Boolean).length;
          if (modes === 0) {
            throw new ValidationError(`repeat "${id}" requires one of: "count", "grid", "polar", "each", or "along"`, path, "MISSING_REQUIRED_FIELD");
          }
          if (modes > 1) {
            throw new ValidationError(`repeat "${id}" cannot combine multiple repeat modes`, path, "OVER_CONSTRAINED");
          }
          
          if (hasCount) {
            if (typeof obj.count === "number") {
              if (obj.count <= 0 || !Number.isInteger(obj.count)) {
                throw new ValidationError(`repeat count must be a positive integer, got ${obj.count}`, `${path}.count`, "INVALID_REPEAT_COUNT");
              }
            }
          }
          if (hasGrid) {
            if (obj.grid.rows === undefined || obj.grid.cols === undefined) {
              throw new ValidationError(`repeat "${id}" grid mode requires both "rows" and "cols"`, `${path}.grid`, "MISSING_REQUIRED_FIELD");
            }
            if (typeof obj.grid.rows === "number") {
              if (obj.grid.rows <= 0 || !Number.isInteger(obj.grid.rows)) {
                throw new ValidationError(`grid rows must be a positive integer, got ${obj.grid.rows}`, `${path}.grid.rows`, "INVALID_REPEAT_COUNT");
              }
            }
            if (typeof obj.grid.cols === "number") {
              if (obj.grid.cols <= 0 || !Number.isInteger(obj.grid.cols)) {
                throw new ValidationError(`grid cols must be a positive integer, got ${obj.grid.cols}`, `${path}.grid.cols`, "INVALID_REPEAT_COUNT");
              }
            }
            if (obj.grid.pitch !== undefined && obj.grid.gap !== undefined) {
              throw new ValidationError(`grid.pitch and grid.gap are mutually exclusive.`, `${path}.grid`, "INVALID_GRID_SPACING");
            }
            if (obj.grid.pitch !== undefined || obj.grid.gap !== undefined) {
              const itemObj = obj.item as any;
              if (itemObj && (itemObj.place !== undefined || itemObj.on !== undefined || itemObj.at !== undefined || itemObj.center !== undefined)) {
                throw new ValidationError(`item placement is not allowed when grid auto-layout is active.`, `${path}.item`, "OVER_CONSTRAINED_REPEAT_LAYOUT");
              }
            }
          }
          if (hasPolar) {
            if (obj.polar.count === undefined) {
              throw new ValidationError(`repeat "${id}" polar mode requires "count"`, `${path}.polar`, "MISSING_REQUIRED_FIELD");
            }
            if (typeof obj.polar.count === "number") {
              if (obj.polar.count <= 0 || !Number.isInteger(obj.polar.count)) {
                throw new ValidationError(`polar count must be a positive integer, got ${obj.polar.count}`, `${path}.polar.count`, "INVALID_REPEAT_COUNT");
              }
            }
          }
          if (hasAlong) {
            const along = (obj as any).along;
            if (!along || typeof along !== "object" || Array.isArray(along)) {
              throw new ValidationError(`repeat "${id}" along mode must be an object`, `${path}.along`, "TYPE_MISMATCH");
            }
            if (along.target === undefined) {
              throw new ValidationError(`repeat "${id}" along mode requires "target"`, `${path}.along.target`, "MISSING_REQUIRED_FIELD");
            }
            if (typeof along.target === "string" && this.doc.objects?.[along.target]) {
              const targetType = this.doc.objects[along.target].type;
              if (!PATH_LIKE_OBJECT_TYPES.has(targetType)) {
                throw new ValidationError(`repeat "${id}" along target must be path-like, got "${targetType}"`, `${path}.along.target`, "INVALID_REPEAT_ALONG_TARGET");
              }
            }
            if (!REPEAT_ALONG_SPACING.has(along.spacing)) {
              throw new ValidationError(`repeat "${id}" along spacing must be one of: uniform-length, uniform-t, fixed-distance`, `${path}.along.spacing`, "INVALID_REPEAT_ALONG_SPACING");
            }
            if (along.spacing === "fixed-distance") {
              if (along.distance === undefined) {
                throw new ValidationError(`repeat "${id}" along fixed-distance requires "distance"`, `${path}.along.distance`, "INVALID_FIXED_DISTANCE");
              }
              if (along.count !== undefined) {
                throw new ValidationError(`repeat "${id}" along fixed-distance does not allow "count" in v0.5`, `${path}.along.count`, "INVALID_REPEAT_ALONG_SPACING");
              }
            } else if (along.count === undefined) {
              throw new ValidationError(`repeat "${id}" along ${along.spacing} requires "count"`, `${path}.along.count`, "MISSING_REQUIRED_FIELD");
            } else if (typeof along.count === "number" && (along.count <= 0 || !Number.isInteger(along.count))) {
              throw new ValidationError(`along count must be a positive integer, got ${along.count}`, `${path}.along.count`, "INVALID_REPEAT_COUNT");
            }

            const itemObj = obj.item as any;
            if (itemObj && itemObj.place !== undefined) {
              throw new ValidationError(`item placement is not allowed when along layout is active.`, `${path}.item`, "OVER_CONSTRAINED_REPEAT_LAYOUT");
            }
          }
        }
        
        if (obj.count !== undefined) validateExpr(obj.count, `${path}.count`);
        if (obj.grid) {
          validateExpr(obj.grid.rows, `${path}.grid.rows`);
          validateExpr(obj.grid.cols, `${path}.grid.cols`);
          if (Array.isArray(obj.grid.gap)) {
            validateExpr(obj.grid.gap[0], `${path}.grid.gap[0]`);
            validateExpr(obj.grid.gap[1], `${path}.grid.gap[1]`);
          } else if (obj.grid.gap !== undefined) {
            validateExpr(obj.grid.gap, `${path}.grid.gap`);
          }
          if (Array.isArray(obj.grid.pitch)) {
            validateExpr(obj.grid.pitch[0], `${path}.grid.pitch[0]`);
            validateExpr(obj.grid.pitch[1], `${path}.grid.pitch[1]`);
          } else if (obj.grid.pitch !== undefined) {
            validateExpr(obj.grid.pitch, `${path}.grid.pitch`);
          }
        }
        if (obj.polar) {
          validateExpr(obj.polar.count, `${path}.polar.count`);
          validateExpr(obj.polar.radius, `${path}.polar.radius`);
          validateExpr(obj.polar.center, `${path}.polar.center`);
        }
        if (obj.each) {
          validateExpr(obj.each, `${path}.each`);
        }
        if ((obj as any).along) {
          const along = (obj as any).along;
          validateExpr(along.target, `${path}.along.target`);
          validateExpr(along.count, `${path}.along.count`);
          validateExpr(along.distance, `${path}.along.distance`);
          validateExpr(along.startOffset, `${path}.along.startOffset`);
          validateExpr(along.endOffset, `${path}.along.endOffset`);
        }
      }

      // Validate custom anchors if present
      if (obj.anchors) {
        for (const [name, pos] of Object.entries<any>(obj.anchors)) {
          if (!Array.isArray(pos) || pos.length !== 2) {
            if (this.mode !== "editor") {
              throw new ValidationError(`Anchor "${name}" must be an array of [x, y]`, `${path}.anchors.${name}`);
            }
          } else {
            validateExpr(pos[0], `${path}.anchors.${name}[0]`);
            validateExpr(pos[1], `${path}.anchors.${name}[1]`);
          }
        }
      }
    }
  }

  private validatePathSegments(segments: any[], basePath: string, validateExpr: Function): void {
    segments.forEach((segment: any, i: number) => {
      const segmentPath = `${basePath}[${i}]`;
      if (typeof segment !== "object" || segment === null) {
        throw new ValidationError(`Path segment must be an object`, segmentPath, "TYPE_MISMATCH");
      }
      const keys = Object.keys(segment);
      if (keys.length !== 1) {
        throw new ValidationError(`Path segment must contain exactly one segment type`, segmentPath, "TYPE_MISMATCH");
      }
      const segmentType = keys[0];
      const value = segment[segmentType];
      const fieldSets: Record<string, string[]> = {
        line: ["from", "to"],
        arc: ["from", "through", "to"],
        quadratic: ["from", "cp", "to"],
        cubic: ["from", "cp1", "cp2", "to"],
      };
      if (segmentType in fieldSets) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new ValidationError(`Path segment data must be an object`, `${segmentPath}.${segmentType}`, "TYPE_MISMATCH");
        }
        const allowedFields = fieldSets[segmentType];
        for (const field of Object.keys(value)) {
          if (!allowedFields.includes(field) || (i > 0 && field === "from")) {
            throw new ValidationError(
              field === "from" ? `"from" is only allowed on the first path segment` : `Unknown field "${field}" on ${segmentType} segment`,
              `${segmentPath}.${segmentType}.${field}`,
              "UNKNOWN_FIELD"
            );
          }
        }
        const requiredFields = i === 0 ? allowedFields : allowedFields.filter((field) => field !== "from");
        if (this.mode !== "editor") {
          const missing = requiredFields.filter((field) => value[field] === undefined);
          if (missing.length > 0) {
            throw new ValidationError(
              `${segmentType} segment requires ${missing.map((field) => `"${field}"`).join(", ")}`,
              `${segmentPath}.${segmentType}.${missing[0]}`,
              "MISSING_REQUIRED_FIELD"
            );
          }
        }
        for (const field of allowedFields) {
          validateExpr(value[field], `${segmentPath}.${segmentType}.${field}`);
        }
      } else if (this.mode !== "editor") {
        throw new ValidationError(`Unknown path segment type: ${segmentType}`, segmentPath, "UNKNOWN_FIELD");
      }
    });
  }

  private validateClosedShapeHoles(holes: any[], path: string, validateExpr: Function): void {
    holes.forEach((hole: any, i: number) => {
      const holePath = `${path}.holes[${i}]`;
      if (typeof hole === "string") {
        validateExpr(hole, holePath);
      } else if (hole && typeof hole === "object") {
        if (hole.segments) {
          this.validatePathSegments(hole.segments, `${holePath}.segments`, validateExpr);
        } else {
          const keys = Object.keys(hole).filter(k => k !== "place");
          const holeType = hole.type || (keys.length === 1 ? keys[0] : undefined);
          const holeData = hole.type ? hole : (holeType ? hole[holeType] : undefined);
          const innerPath = hole.type ? holePath : (holeType ? `${holePath}.${holeType}` : holePath);

          if (holeType === "rect") {
            if (holeData.size) {
              validateExpr(holeData.size[0], `${innerPath}.size[0]`);
              validateExpr(holeData.size[1], `${innerPath}.size[1]`);
            }
          } else if (holeType === "circle") {
            validateExpr(holeData.center, `${innerPath}.center`);
            validateExpr(holeData.radius, `${innerPath}.radius`);
          } else if (holeType === "polygon") {
            if (Array.isArray(holeData.points)) {
              holeData.points.forEach((pt: any, idx: number) => validateExpr(pt, `${innerPath}.points[${idx}]`));
            }
          } else if (holeType === "path") {
            if (Array.isArray(holeData.segments)) {
              this.validatePathSegments(holeData.segments, `${innerPath}.segments`, validateExpr);
            }
          } else if (holeType === "clone") {
            if (holeData.of) {
              validateExpr(holeData.of, `${innerPath}.of`);
            }
          } else if (holeType === "segments" && Array.isArray(holeData)) {
            this.validatePathSegments(holeData, `${innerPath}`, validateExpr);
          } else {
            throw new ValidationError(`Hole must be a string reference, an object with segments, or a closed shape definition`, holePath, "TYPE_MISMATCH");
          }

          const placeObj = hole.place || holeData?.place;
          if (placeObj) this.validatePlace(placeObj, holePath, validateExpr);
        }
      } else {
        throw new ValidationError(`Hole must be a string reference, an object with segments, or a closed shape definition`, holePath, "TYPE_MISMATCH");
      }
    });
  }

  private validatePlace(place: any, path: string, validateExpr: Function): void {
    if (typeof place !== "object" || place === null || Array.isArray(place)) {
      throw new ValidationError(`"place" must be an object with constraints (e.g., { left: 0, top: 0 })`, path, "INVALID_TYPE");
    }
    const pathParts = path.split(".");
    const isComponent = pathParts.length >= 2 && pathParts[0] === "objects" && this.doc.objects && this.doc.objects[pathParts[1]]?.type === "component";
    for (const [key, value] of Object.entries(place)) {
      if (!PLACE_FIELDS.has(key) && !isComponent) {
        if (this.mode !== "editor") {
          throw new ValidationError(
            `Unknown place field: ${key}`,
            `${path}.place.${key}`,
            "UNKNOWN_FIELD"
          );
        }
      }
      validateExpr(value, `${path}.place.${key}`);
    }
  }

  private validateOn(on: any, path: string, validateExpr: Function): void {
    if (typeof on !== "object" || on === null || Array.isArray(on)) {
      throw new ValidationError(`"on" must be an object specifying a point, path, or frame`, path, "INVALID_TYPE");
    }
    const keys = Object.keys(on);
    if (keys.length === 0) {
      throw new ValidationError(`"on" placement requires either "point", "path", or "frame"`, path, "MISSING_REQUIRED_FIELD");
    }
    if (keys.length > 1) {
      throw new ValidationError(`"on" placement cannot combine multiple namespaces`, path, "OVER_CONSTRAINED");
    }
    const namespace = keys[0];
    if (namespace !== "point" && namespace !== "path" && namespace !== "frame") {
      throw new ValidationError(`Unknown on placement namespace: ${namespace}. Expected "point", "path", or "frame"`, `${path}.on.${namespace}`, "UNKNOWN_FIELD");
    }
    const spec = on[namespace];
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      throw new ValidationError(`"on.${namespace}" must be an object`, `${path}.on.${namespace}`, "INVALID_TYPE");
    }

    if (namespace === "point") {
      if (spec.at === undefined) throw new ValidationError(`"at" is required in "on.point"`, `${path}.on.point.at`, "MISSING_REQUIRED_FIELD");
      validateExpr(spec.at, `${path}.on.point.at`);
      if (spec.anchor !== undefined) validateExpr(spec.anchor, `${path}.on.point.anchor`);
    } else {
      if (spec.path === undefined) throw new ValidationError(`"path" is required in "on.${namespace}"`, `${path}.on.${namespace}.path`, "MISSING_REQUIRED_FIELD");
      if (spec.t === undefined) throw new ValidationError(`"t" is required in "on.${namespace}"`, `${path}.on.${namespace}.t`, "MISSING_REQUIRED_FIELD");
      
      if (typeof spec.path !== "string") throw new ValidationError(`"path" in "on.${namespace}" must be a string (object ID)`, `${path}.on.${namespace}.path`, "TYPE_MISMATCH");
      if (this.doc && this.doc.objects) {
        const target = this.doc.objects[spec.path];
        if (!target && this.mode !== "editor") {
          throw new ValidationError(`Unknown reference: ${spec.path}`, `${path}.on.${namespace}.path`, "UNKNOWN_REFERENCE");
        }
      }
      validateExpr(spec.t, `${path}.on.${namespace}.t`);
      if (spec.anchor !== undefined) validateExpr(spec.anchor, `${path}.on.${namespace}.anchor`);
    }
  }

  private validateTransform(transform: any, path: string, validateExpr: Function): void {
    if (!transform) return;

    const validateOp = (op: any, opPath: string) => {
      if (typeof op !== 'object' || op === null) {
        throw new ValidationError("Transform operation must be an object", opPath, "INVALID_TYPE");
      }

      const keys = Object.keys(op).filter(k => k !== 'origin');
      if (keys.length === 0) {
        throw new ValidationError("Transform operation must have at least one key (translate, rotate, scale, or mirror)", opPath, "MISSING_REQUIRED_FIELD");
      }
      if (keys.length > 1) {
        throw new ValidationError(`Transform operation must have exactly one key (excluding origin), found: ${keys.join(', ')}`, opPath, "OVER_CONSTRAINED");
      }

      const opType = keys[0];
      const val = op[opType];

      if (opType === 'translate') {
        if (!Array.isArray(val) || val.length !== 2) {
          throw new ValidationError("translate must be an array of [x, y]", `${opPath}.translate`, "INVALID_TYPE");
        }
        validateExpr(val[0], `${opPath}.translate[0]`);
        validateExpr(val[1], `${opPath}.translate[1]`);
      } else if (opType === 'rotate') {
        if (typeof val === 'object' && val !== null) {
          if (this.mode !== "editor" && val.angle === undefined) {
            throw new ValidationError(`rotate object requires "angle"`, `${opPath}.rotate`, "MISSING_REQUIRED_FIELD");
          }
          validateExpr(val.angle, `${opPath}.rotate.angle`);
          if (val.origin) validateExpr(val.origin, `${opPath}.rotate.origin`);
        } else {
          validateExpr(val, `${opPath}.rotate`);
        }
      } else if (opType === 'scale') {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          if (this.mode !== "editor" && val.factor === undefined) {
            throw new ValidationError(`scale object requires "factor"`, `${opPath}.scale`, "MISSING_REQUIRED_FIELD");
          }
          validateExpr(val.factor, `${opPath}.scale.factor`);
          if (val.origin) validateExpr(val.origin, `${opPath}.scale.origin`);
        } else if (Array.isArray(val)) {
          if (this.mode !== "editor" && val.length !== 2) {
            throw new ValidationError(`scale array must have exactly 2 elements [sx, sy]`, `${opPath}.scale`, "INVALID_VALUE");
          }
          validateExpr(val[0], `${opPath}.scale[0]`);
          validateExpr(val[1], `${opPath}.scale[1]`);
        } else {
          validateExpr(val, `${opPath}.scale`);
        }
      } else if (opType === 'mirror') {
        if (typeof val === 'object' && val !== null) {
          if (this.mode !== "editor" && val.axis !== undefined && !MIRROR_AXES.has(val.axis)) {
            throw new ValidationError(`Invalid mirror axis: ${val.axis}. Expected "x", "y", or "both"`, `${opPath}.mirror.axis`, "INVALID_VALUE");
          }
          if (val.origin) validateExpr(val.origin, `${opPath}.mirror.origin`);
        } else if (typeof val === "string") {
          if (this.mode !== "editor" && !MIRROR_AXES.has(val)) {
            throw new ValidationError(`Invalid mirror axis: ${val}. Expected "x", "y", or "both"`, `${opPath}.mirror`, "INVALID_VALUE");
          }
        }
      } else {
        throw new ValidationError(`Unknown transform operation: ${opType}`, opPath, "UNKNOWN_FIELD");
      }

      if (op.origin) {
        validateExpr(op.origin, `${opPath}.origin`);
      }
    };

    if (Array.isArray(transform)) {
      transform.forEach((op, i) => validateOp(op, `${path}.transform[${i}]`));
    } else {
      validateOp(transform, `${path}.transform`);
    }
  }

  private validateConstraints(): void {
    if (this.mode === "editor") return;

    // 1. Place constraints (under/over constrained)
    for (const [id, obj] of Object.entries<any>(this.doc.objects || {})) {
      if (obj.place) {
        this.validatePlaceConstraints(id, obj);
      }
    }

    // 2. Document-level constraints (equal, perpendicular, parallel, align)
    if (this.doc.constraints) {
      this.doc.constraints.forEach((c, i) => {
        const path = `constraints[${i}]`;
        if ("equal" in c) {
          const args = c.equal;
          if (Array.isArray(args)) {
            if (args.length < 2) {
              throw new ValidationError(`"equal" constraint requires at least 2 arguments`, path);
            }
            args.forEach(arg => validateExpressionSyntax(String(arg)));
          } else if (args && typeof args === "object") {
            if ((args as any).left === undefined || (args as any).right === undefined) {
              throw new ValidationError(`"equal" object-form requires "left" and "right"`, path, "MISSING_REQUIRED_FIELD");
            }
            validateExpressionSyntax(String((args as any).left));
            validateExpressionSyntax(String((args as any).right));
          } else {
            throw new ValidationError(`"equal" constraint must be an array or object-form`, path, "INVALID_VALUE");
          }
        } else if ("perpendicular" in c) {
          if (!Array.isArray(c.perpendicular) || c.perpendicular.length !== 2) {
            throw new ValidationError(`"perpendicular" constraint requires exactly 2 line references`, path);
          }
          c.perpendicular.forEach((ref, j) => {
            const target = this.doc.objects?.[ref];
            if (!target) throw new ValidationError(`Unknown reference "${ref}"`, `${path}.perpendicular[${j}]`, "UNKNOWN_REFERENCE");
            if (target.type !== "line") throw new ValidationError(`Reference "${ref}" is not a line`, `${path}.perpendicular[${j}]`, "TYPE_MISMATCH");
          });
        } else if ("parallel" in c) {
          if (!Array.isArray(c.parallel) || c.parallel.length !== 2) {
            throw new ValidationError(`"parallel" constraint requires exactly 2 line references`, path);
          }
          c.parallel.forEach((ref, j) => {
            const target = this.doc.objects?.[ref];
            if (!target) throw new ValidationError(`Unknown reference "${ref}"`, `${path}.parallel[${j}]`, "UNKNOWN_REFERENCE");
            if (target.type !== "line") throw new ValidationError(`Reference "${ref}" is not a line`, `${path}.parallel[${j}]`, "TYPE_MISMATCH");
          });
        } else if ("tangent" in c) {
          if (!Array.isArray((c as any).tangent) || (c as any).tangent.length !== 2) {
            throw new ValidationError(`"tangent" constraint requires exactly 2 references`, path);
          }
          const targets = (c as any).tangent.map((ref: string, j: number) => {
            const target = this.doc.objects?.[ref];
            if (!target) throw new ValidationError(`Unknown reference "${ref}"`, `${path}.tangent[${j}]`, "UNKNOWN_REFERENCE");
            return target;
          });
          const [a, b] = targets;
          const isSupportedPair =
            (a.type === "line" && ["circle", "arc"].includes(b.type)) ||
            (b.type === "line" && ["circle", "arc"].includes(a.type));
          if (!isSupportedPair) {
            throw new ValidationError(`"tangent" constraint currently requires one line and one circle/arc reference`, path, "TYPE_MISMATCH");
          }
        } else if ("align" in c) {
          if (!c.align.target || !c.align.with) {
            throw new ValidationError(`"align" constraint requires "target" and "with"`, path);
          }

          if (c.align.offset !== undefined) {
              const SCALAR_ANCHORS = new Set(["left", "right", "top", "bottom", "centerX", "centerY", "x", "y", "cx", "cy", "r", "radius"]);
              
              const isScalarAnchor = (ref: any) => {
                  if (typeof ref !== "string") return false;
                  if (!ref.includes(".")) return false;
                  const anchor = ref.split(".")[1];
                  return SCALAR_ANCHORS.has(anchor);
              };

              const isScalarTarget = isScalarAnchor(c.align.target);
              const isScalarWith = isScalarAnchor(c.align.with);

              if (!isScalarTarget || !isScalarWith) {
                  throw new ValidationError(`offset scalar is not allowed for point anchor in v0.2`, path, "INVALID_CONSTRAINT");
              }
          }
        }
      });
    }
  }

  private validatePlaceConstraints(id: string, obj: any): void {
    const place = obj.place || obj.center || {};

    const hSources: string[] = [];
    const vSources: string[] = [];

    // If place/center is a direct reference (string) or coordinate array, it satisfies both axes
    if (typeof place === "string" || Array.isArray(place)) {
      hSources.push("direct");
      vSources.push("direct");
    } else {
      if (place.inside !== undefined) {
        hSources.push("inside");
        vSources.push("inside");
      }

      if (place.left !== undefined) hSources.push("left");
      if (place.right !== undefined) hSources.push("right");
      if (place.centerX !== undefined) hSources.push("centerX");
      
      if (place.top !== undefined) vSources.push("top");
      if (place.bottom !== undefined) vSources.push("bottom");
      if (place.centerY !== undefined) vSources.push("centerY");

      // Unified anchors
      if (place.center !== undefined) {
        hSources.push("center");
        vSources.push("center");
      }
      if (place.topLeft !== undefined) {
        hSources.push("topLeft");
        vSources.push("topLeft");
      }
      if (place.topRight !== undefined) {
        hSources.push("topRight");
        vSources.push("topRight");
      }
      if (place.bottomLeft !== undefined) {
        hSources.push("bottomLeft");
        vSources.push("bottomLeft");
      }
      if (place.bottomRight !== undefined) {
        hSources.push("bottomRight");
        vSources.push("bottomRight");
      }
      if (place.topCenter !== undefined) {
        hSources.push("topCenter");
        vSources.push("topCenter");
      }
      if (place.bottomCenter !== undefined) {
        hSources.push("bottomCenter");
        vSources.push("bottomCenter");
      }
    }
    if (place.centerLeft !== undefined) {
      hSources.push("centerLeft");
      vSources.push("centerLeft");
    }
    if (place.centerRight !== undefined) {
      hSources.push("centerRight");
      vSources.push("centerRight");
    }

    if (hSources.length > 1) {
      throw new ValidationError(`${obj.type} "${id}" is over-constrained horizontally. Found multiple positions: ${hSources.join(", ")}.`, `objects.${id}`, "OVER_CONSTRAINED");
    }
    if (hSources.length === 0) {
      const isComponentWithCustomPlace = obj.type === "component" && Object.keys(place).some(k => !PLACE_FIELDS.has(k));
      if (!isComponentWithCustomPlace) {
        throw new ValidationError(`${obj.type} "${id}" is under-constrained horizontally. Missing horizontal position in "place".`, `objects.${id}`, "UNDER_CONSTRAINED");
      }
    }

    if (vSources.length > 1) {
      throw new ValidationError(`${obj.type} "${id}" is over-constrained vertically. Found multiple positions: ${vSources.join(", ")}.`, `objects.${id}`, "OVER_CONSTRAINED");
    }
    if (vSources.length === 0) {
      const isComponentWithCustomPlace = obj.type === "component" && Object.keys(place).some(k => !PLACE_FIELDS.has(k));
      if (!isComponentWithCustomPlace) {
        throw new ValidationError(`${obj.type} "${id}" is under-constrained vertically. Missing vertical position in "place".`, `objects.${id}`, "UNDER_CONSTRAINED");
      }
    }
  }

  private validateScene(): void {
    const scene = this.doc.scene;
    if (!scene) return;

    if (scene.unit !== undefined && !SCENE_UNITS.has(scene.unit)) {
      throw new ValidationError(`Invalid scene unit: ${scene.unit}. Expected one of: mm, cm, m, in, px`, "scene.unit", "INVALID_VALUE");
    }

    if (scene.orientation !== undefined && !SCENE_ORIENTATIONS.has(scene.orientation)) {
      throw new ValidationError(`Invalid scene orientation: ${scene.orientation}. Expected one of: y-down, y-up`, "scene.orientation", "INVALID_VALUE");
    }

    if (scene.origin !== undefined && !SCENE_ORIGINS.has(scene.origin as string)) {
      throw new ValidationError(`Invalid scene origin: ${scene.origin}. Expected one of: top-left, bottom-left, center`, "scene.origin", "INVALID_VALUE");
    }

  }

  private validateSheetsAndViews(): void {
    if (this.doc.views) {
      if (typeof this.doc.views !== "object" || Array.isArray(this.doc.views)) {
        throw new ValidationError("views must be an object", "views", "INVALID_VALUE");
      }
      for (const [viewId, viewDef] of Object.entries(this.doc.views)) {
        const path = `views.${viewId}`;
        if (!viewDef || typeof viewDef !== "object") {
          throw new ValidationError(`view "${viewId}" must be an object`, path, "INVALID_VALUE");
        }
        if (viewDef.target === undefined) {
          throw new ValidationError(`view "${viewId}" requires "target"`, path, "MISSING_REQUIRED_FIELD");
        }
        if (typeof viewDef.target !== "string" || !this.objectIds.has(viewDef.target)) {
          throw new ValidationError(`view "${viewId}" target "${viewDef.target}" not found`, `${path}.target`, "UNKNOWN_REFERENCE");
        }
        if (viewDef.scale !== undefined) {
          if (typeof viewDef.scale !== "number" && typeof viewDef.scale !== "string") {
            throw new ValidationError(`view "${viewId}" scale must be a number or string`, `${path}.scale`, "INVALID_VALUE");
          }
          if (typeof viewDef.scale === "string") {
            const parts = viewDef.scale.split(":");
            if (parts.length > 2) {
              throw new ValidationError(`view "${viewId}" scale format invalid: ${viewDef.scale}`, `${path}.scale`, "INVALID_VALUE");
            }
          }
        }
        if (viewDef.filter && typeof viewDef.filter === "object") {
          if (viewDef.filter.roles !== undefined) {
            if (!Array.isArray(viewDef.filter.roles)) {
              throw new ValidationError(`view "${viewId}" filter roles must be an array`, `${path}.filter.roles`, "INVALID_VALUE");
            }
            for (const r of viewDef.filter.roles) {
              if (typeof r !== "string") {
                throw new ValidationError(`view "${viewId}" filter role must be a string`, `${path}.filter.roles`, "INVALID_VALUE");
              }
            }
          }
        }
      }
    }

    if (this.doc.sheets) {
      if (typeof this.doc.sheets !== "object" || Array.isArray(this.doc.sheets)) {
        throw new ValidationError("sheets must be an object", "sheets", "INVALID_VALUE");
      }
      for (const [sheetId, sheetDef] of Object.entries(this.doc.sheets)) {
        const path = `sheets.${sheetId}`;
        if (!sheetDef || typeof sheetDef !== "object") {
          throw new ValidationError(`sheet "${sheetId}" must be an object`, path, "INVALID_VALUE");
        }
        if (sheetDef.size === undefined) {
          throw new ValidationError(`sheet "${sheetId}" requires "size"`, path, "MISSING_REQUIRED_FIELD");
        }
        if (typeof sheetDef.size !== "string" && !Array.isArray(sheetDef.size)) {
          throw new ValidationError(`sheet "${sheetId}" size must be a string or array of length expressions`, `${path}.size`, "INVALID_VALUE");
        }
        if (typeof sheetDef.size === "string") {
          const normalizedSize = sheetDef.size.toUpperCase();
          if (!["A0", "A1", "A2", "A3", "A4"].includes(normalizedSize)) {
            throw new ValidationError(`sheet "${sheetId}" size "${sheetDef.size}" is invalid. Expected one of: A0, A1, A2, A3, A4`, `${path}.size`, "INVALID_VALUE");
          }
        }
        if (sheetDef.orientation !== undefined && !["portrait", "landscape"].includes(sheetDef.orientation)) {
          throw new ValidationError(`sheet "${sheetId}" orientation must be portrait or landscape`, `${path}.orientation`, "INVALID_VALUE");
        }
        if (sheetDef.views) {
          if (!Array.isArray(sheetDef.views)) {
            throw new ValidationError(`sheet "${sheetId}" views must be an array`, `${path}.views`, "INVALID_VALUE");
          }
          sheetDef.views.forEach((placement, idx) => {
            const viewPath = `${path}.views[${idx}]`;
            if (!placement || typeof placement !== "object") {
              throw new ValidationError("view placement must be an object", viewPath, "INVALID_VALUE");
            }
            if (placement.use === undefined) {
              throw new ValidationError("view placement requires 'use'", viewPath, "MISSING_REQUIRED_FIELD");
            }
            if (typeof placement.use !== "string" || !this.doc.views || !this.doc.views[placement.use]) {
              throw new ValidationError(`view placement 'use' reference "${placement.use}" not found`, `${viewPath}.use`, "UNKNOWN_REFERENCE");
            }
            if (placement.place) {
              if (placement.place.topLeft !== undefined && placement.place.center !== undefined) {
                throw new ValidationError("sheet view placement may use only one of topLeft or center", `${viewPath}.place`, "INVALID_VALUE");
              }
              if (placement.place.topLeft) {
                if (!Array.isArray(placement.place.topLeft) || placement.place.topLeft.length !== 2) {
                  throw new ValidationError("topLeft place must be a [x, y] coordinate array", `${viewPath}.place.topLeft`, "INVALID_VALUE");
                }
              } else if (placement.place.center) {
                if (!Array.isArray(placement.place.center) || placement.place.center.length !== 2) {
                  throw new ValidationError("center place must be a [x, y] coordinate array", `${viewPath}.place.center`, "INVALID_VALUE");
                }
              }
            }
          });
        }
      }
    }
  }

  private validateParameters(): void {
    if (!this.doc.parameters) return;

    const VALID_TYPES = new Set([
      "length", "number", "angle", "percent", "boolean", "enum", "string",
      "point", "vector", "array", "object", "frame2d", "bbox2d", "collection", "path-ref"
    ]);

    for (const [id, param] of Object.entries(this.doc.parameters)) {
      const path = `parameters.${id}`;
      
      // If standard parameter definition with an object
      if (param && typeof param === "object" && !Array.isArray(param) && "type" in param) {
        const type = (param as any).type;
        const defValue = (param as any).default;

        if (this.mode !== "editor") {
          if (!VALID_TYPES.has(type)) {
            throw new ValidationError(`Unknown parameter type: "${type}"`, `${path}.type`, "INVALID_TYPE");
          }

          if (defValue === undefined || defValue === null) {
            throw new ValidationError(`Parameter "${id}" of type "${type}" must have a default value`, `${path}.default`, "MISSING_REQUIRED_FIELD");
          }

          this.validateValueType(defValue, type, `${path}.default`);
        }
      }
    }
  }

  private validateValueType(val: any, type: string, path: string): void {
    if (val === null || val === undefined) return;

    switch (type) {
      case "boolean":
        if (typeof val !== "boolean" && val !== "true" && val !== "false") {
          throw new ValidationError(`Value must be a boolean, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
        }
        break;
      case "number":
        if (typeof val !== "number") {
          const num = parseFloat(String(val));
          if (isNaN(num)) {
            throw new ValidationError(`Value must be a number, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
          }
        }
        break;
      case "length":
        if (typeof val !== "number") {
          const str = String(val);
          const hasUnit = /^[+-]?([\d.]+)(px|mm|cm|m)?$/.test(str);
          if (!hasUnit) {
            throw new ValidationError(`Value must be a valid length (e.g. 10px, 20mm), got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
          }
        }
        break;
      case "angle":
        if (typeof val !== "number") {
          const str = String(val);
          const hasUnit = /^[+-]?([\d.]+)(deg|rad)?$/.test(str);
          if (!hasUnit) {
            throw new ValidationError(`Value must be a valid angle (e.g. 90deg, 1.5rad), got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
          }
        }
        break;
      case "percent":
        if (typeof val !== "number") {
          const str = String(val);
          const hasUnit = /^[+-]?([\d.]+)%?$/.test(str);
          if (!hasUnit) {
            throw new ValidationError(`Value must be a valid percentage (e.g. 50%), got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
          }
        }
        break;
      case "point":
      case "vector":
        if (!Array.isArray(val) || val.length !== 2) {
          throw new ValidationError(`Value must be an array of exactly 2 coordinates, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
        }
        val.forEach((coord, i) => {
          if (typeof coord !== "number") {
            const str = String(coord);
            const hasUnit = /^[+-]?([\d.]+)(px|mm|cm|m)?$/.test(str);
            if (!hasUnit) {
              throw new ValidationError(`Coordinate at index ${i} must be a valid length, got: ${JSON.stringify(coord)}`, `${path}[${i}]`, "TYPE_MISMATCH");
            }
          }
        });
        break;
      case "array":
        if (!Array.isArray(val)) {
          throw new ValidationError(`Value must be an array, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
        }
        break;
      case "object":
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          throw new ValidationError(`Value must be an object, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
        }
        break;
      case "string":
        if (typeof val !== "string") {
          throw new ValidationError(`Value must be a string, got: ${JSON.stringify(val)}`, path, "TYPE_MISMATCH");
        }
        break;
    }
  }
}
