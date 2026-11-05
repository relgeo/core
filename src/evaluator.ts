import type { LengthUnit, RelGeoError, ResolvedObject } from "./types";
import { normalizeUnit } from "./units";
import { intersectLines, computeIntersections, applySelector, type IntersectionSelector } from "./resolver/intersection";
import { applyTransformPipeline } from "./resolver/transform-utils";
import { CoreError, hasStructuredDiagnostic, normalizeErrorCode, stripErrorCodePrefix } from "./errors";

export interface EvalContext {
  scalars: Record<string, any>;
  targetUnit: LengthUnit;
  objects?: Record<string, ResolvedObject>;
  resolveIdentifier?: (name: string) => unknown;
  parentMap?: Map<string, string>;
}

export interface EvaluatorOptions {
  allowUnknownIdentifiers?: boolean;
  allowUnknownGeometryObjects?: boolean;
}

/**
 * A minimal recursive descent parser for math expressions.
 * Supports: +, -, *, /, (), numbers, units, and identifiers.
 */
export interface TypedValue {
  type: "number" | "length" | "point" | "vector" | "object" | "array" | "collection" | "frame2d" | "bbox2d" | "boolean" | "string";
  value: any;
}

export interface EvalContext {
  scalars: Record<string, any>;
  targetUnit: LengthUnit;
  objects?: Record<string, ResolvedObject>;
  resolveIdentifier?: (name: string) => unknown;
  parentMap?: Map<string, string>;

  // v0.4 typed extensions:
  get?: (name: string) => TypedValue | undefined;
  getMember?: (value: TypedValue, key: string) => TypedValue | undefined;
  getIndex?: (value: TypedValue, index: any) => TypedValue | undefined;
  callFunction?: (name: string, args: TypedValue[]) => TypedValue | undefined;
}

function normalizeEvaluatorError(
  error: unknown,
  phase: "validate" | "resolve",
): CoreError {
  // A structured error already has an intentional phase. Preserve it even
  // when an evaluator is used by a different public entry point.
  if (error instanceof CoreError) return error;
  if (hasStructuredDiagnostic(error)) {
    const candidate = error as Error & Partial<RelGeoError> & Pick<RelGeoError, "phase" | "code">;
    const code = normalizeErrorCode(candidate.code, candidate.message, "UNKNOWN_ERROR");
    return new CoreError(stripErrorCodePrefix(candidate.message), code, {
      phase: candidate.phase ?? "resolve",
      severity: candidate.severity,
      path: candidate.path,
      objectId: candidate.objectId,
      dependencyChain: candidate.dependencyChain,
      range: candidate.range,
    });
  }
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; path?: string; objectId?: string }
    : {};
  const rawMessage = error instanceof Error ? error.message : String(error);
  const code = normalizeErrorCode(candidate.code, rawMessage, "INVALID_EXPRESSION");
  return new CoreError(stripErrorCodePrefix(rawMessage), code, {
    phase,
    path: candidate.path,
    objectId: candidate.objectId,
  });
}

export class Evaluator {
  private tokens: string[] = [];
  private pos = 0;
  private context: EvalContext;
  private options: EvaluatorOptions;

  constructor(context: EvalContext, options: EvaluatorOptions = {}) {
    this.context = context;
    this.options = options;
  }

  private wrap(val: any): TypedValue {
    if (val && typeof val === "object" && "type" in val && "value" in val) {
      return val as TypedValue;
    }
    if (typeof val === "number") {
      return { type: "number", value: val };
    }
    if (typeof val === "boolean") {
      return { type: "boolean", value: val };
    }
    if (typeof val === "string") {
      return { type: "string", value: val };
    }
    if (val && typeof val === "object" && "x" in val && "y" in val) {
      return { type: "point", value: val };
    }
    if (Array.isArray(val)) {
      return { type: "array", value: val };
    }
    return { type: "object", value: val };
  }

  private unwrap(val: any): any {
    if (val && typeof val === "object" && "type" in val && "value" in val) {
      return val.value;
    }
    return val;
  }

  private evaluateInternal(expression: string | number): any {
    if (typeof expression === "number") return expression;

    // Tokenize
    this.tokens = this.tokenize(expression);
    this.pos = 0;

    if (this.tokens.length === 0) return 0;

    const result = this.parseExpression();
    if (this.pos !== this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.pos]}`);
    }

    return this.unwrap(result);
  }

  private evaluateTypedInternal(expression: string | number): TypedValue {
    if (typeof expression === "number") {
      return { type: "number", value: expression };
    }

    this.tokens = this.tokenize(expression);
    this.pos = 0;

    if (this.tokens.length === 0) {
      return { type: "number", value: 0 };
    }

    const result = this.parseExpression();
    if (this.pos !== this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.pos]}`);
    }

    return result;
  }

  evaluate(expression: string | number): any {
    try {
      return this.evaluateInternal(expression);
    } catch (error) {
      throw normalizeEvaluatorError(error, "resolve");
    }
  }

  evaluateTyped(expression: string | number): TypedValue {
    try {
      return this.evaluateTypedInternal(expression);
    } catch (error) {
      throw normalizeEvaluatorError(error, "resolve");
    }
  }

  private tokenize(expr: string): string[] {
    const regex = /(\s+)|(\d+(?:\.\d+)?(?:px|mm|cm|m|%|deg|rad)?|[a-zA-Z_][a-zA-Z0-9_]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|==|!=|<=|>=|&&|\|\||[-+*/(),:{}\[\]\.<>?%^!])/g;
    const tokens: string[] = [];
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(expr)) !== null) {
      if (match.index !== lastIndex) {
        throw new Error(`Invalid expression syntax: ${expr}`);
      }
      if (!match[1]) {
        tokens.push(match[0]);
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex !== expr.length) {
      throw new Error(`Invalid expression syntax: ${expr}`);
    }
    return tokens;
  }

  private parseExpression(): TypedValue {
    return this.parseTernary();
  }

  private parseTernary(): TypedValue {
    let result = this.parseLogicalOr();
    if (this.pos < this.tokens.length && this.tokens[this.pos] === "?") {
      this.pos++;
      const trueVal = this.parseExpression();
      if (this.pos >= this.tokens.length || this.tokens[this.pos] !== ":") {
        throw new Error("Expected ':' in ternary operator");
      }
      this.pos++;
      const falseVal = this.parseExpression();
      const cond = this.unwrap(result);
      result = cond ? trueVal : falseVal;
    }
    return result;
  }

  private parseLogicalOr(): TypedValue {
    let result = this.parseLogicalAnd();
    while (this.pos < this.tokens.length && this.tokens[this.pos] === "||") {
      this.pos++;
      const right = this.parseLogicalAnd();
      result = { type: "boolean", value: !!(this.unwrap(result) || this.unwrap(right)) };
    }
    return result;
  }

  private parseLogicalAnd(): TypedValue {
    let result = this.parseEquality();
    while (this.pos < this.tokens.length && this.tokens[this.pos] === "&&") {
      this.pos++;
      const right = this.parseEquality();
      result = { type: "boolean", value: !!(this.unwrap(result) && this.unwrap(right)) };
    }
    return result;
  }

  private parseEquality(): TypedValue {
    let result = this.parseRelational();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === "==" || token === "!=") {
        this.pos++;
        const right = this.parseRelational();
        const lVal = this.unwrap(result);
        const rVal = this.unwrap(right);
        if (token === "==") {
          result = { type: "boolean", value: lVal === rVal };
        } else {
          result = { type: "boolean", value: lVal !== rVal };
        }
      } else {
        break;
      }
    }
    return result;
  }

  private parseRelational(): TypedValue {
    let result = this.parseAdditive();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === "<" || token === ">" || token === "<=" || token === ">=") {
        this.pos++;
        const right = this.parseAdditive();
        const lVal = this.unwrap(result);
        const rVal = this.unwrap(right);
        if (typeof lVal !== "number" || typeof rVal !== "number") {
          throw new Error("Relational operators are only allowed on numbers");
        }
        if (token === "<") result = { type: "boolean", value: lVal < rVal };
        else if (token === ">") result = { type: "boolean", value: lVal > rVal };
        else if (token === "<=") result = { type: "boolean", value: lVal <= rVal };
        else if (token === ">=") result = { type: "boolean", value: lVal >= rVal };
      } else {
        break;
      }
    }
    return result;
  }

  private parseAdditive(): TypedValue {
    let result = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === "+" || token === "-") {
        this.pos++;
        const term = this.parseTerm();
        const rVal = this.unwrap(result);
        const tVal = this.unwrap(term);
        if (typeof rVal !== "number" || typeof tVal !== "number") {
          throw new Error(`Arithmetic operations are only allowed on numbers/lengths`);
        }
        result = { type: "number", value: token === "+" ? rVal + tVal : rVal - tVal };
      } else {
        break;
      }
    }

    return result;
  }

  private parseTerm(): TypedValue {
    let result = this.parseExponentiation();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === "*" || token === "/" || token === "%") {
        this.pos++;
        const factor = this.parseExponentiation();
        const rVal = this.unwrap(result);
        const fVal = this.unwrap(factor);
        if (typeof rVal !== "number" || typeof fVal !== "number") {
          throw new Error(`Arithmetic operations are only allowed on numbers/lengths`);
        }
        if (token === "*") {
          result = { type: "number", value: rVal * fVal };
        } else if (token === "/") {
          if (fVal === 0) throw new Error("Division by zero");
          result = { type: "number", value: rVal / fVal };
        } else if (token === "%") {
          result = { type: "number", value: rVal % fVal };
        }
      } else {
        break;
      }
    }

    return result;
  }

  private parseExponentiation(): TypedValue {
    let result = this.parseFactor();
    
    while (this.pos < this.tokens.length && this.tokens[this.pos] === "^") {
      this.pos++;
      // Right-associative exponentiation by calling itself recursively
      const right = this.parseExponentiation();
      const lVal = this.unwrap(result);
      const rVal = this.unwrap(right);
      if (typeof lVal !== "number" || typeof rVal !== "number") {
        throw new Error("Exponentiation is only allowed on numbers");
      }
      result = { type: "number", value: Math.pow(lVal, rVal) };
    }
    
    return result;
  }

  private tryReconstructAndResolve(baseToken: string): TypedValue | undefined {
    if (!this.context.resolveIdentifier) return undefined;
    let path = baseToken;
    let lookAheadPos = this.pos;

    while (lookAheadPos < this.tokens.length) {
      if (this.tokens[lookAheadPos] === ".") {
        const nextId = this.tokens[lookAheadPos + 1];
        if (nextId && /^[a-zA-Z_]/.test(nextId)) {
          path += "." + nextId;
          lookAheadPos += 2;
          const resolved = this.context.resolveIdentifier(path);
          if (resolved !== undefined) {
            this.pos = lookAheadPos;
            return this.wrap(resolved);
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return undefined;
  }

  private parseFactor(): TypedValue {
    let result = this.parseBaseFactor();

    while (this.pos < this.tokens.length) {
      const nextToken = this.tokens[this.pos];
      if (nextToken === ".") {
        this.pos++; // consume '.'
        const member = this.tokens[this.pos++];
        if (!member || !/^[a-zA-Z_]/.test(member)) {
          throw new Error(`Expected member identifier after '.'`);
        }
        result = this.evaluateMember(result, member);
      } else if (nextToken === "[") {
        this.pos++; // consume '['
        const indexExpressions: TypedValue[] = [this.parseExpression()];
        while (this.tokens[this.pos] === ",") {
          this.pos++; // consume ','
          indexExpressions.push(this.parseExpression());
        }
        if (this.tokens[this.pos++] !== "]") {
          throw new Error("Missing closing bracket ']'");
        }
        result = this.evaluateIndex(result, indexExpressions.length === 1 ? indexExpressions[0] : indexExpressions);
      } else {
        break;
      }
    }

    return result;
  }

  private evaluateMember(obj: TypedValue, member: string): TypedValue {
    if (this.context.getMember) {
      const val = this.context.getMember(obj, member);
      if (val !== undefined) return val;
    }
    const val = obj.value;
    if (val && typeof val === "object") {
      if (member in val) {
        return this.wrap(val[member]);
      }
    }
    if (this.options.allowUnknownIdentifiers) {
      return { type: "number", value: 1 };
    }
    throw new Error(`Cannot access member "${member}" on value of type "${obj.type}"`);
  }

  private evaluateIndex(arr: TypedValue, indexVal: TypedValue | TypedValue[]): TypedValue {
    if (this.context.getIndex) {
      const unwrappedIdx = Array.isArray(indexVal)
        ? indexVal.map(idx => this.unwrap(idx))
        : this.unwrap(indexVal);
      const val = this.context.getIndex(arr, unwrappedIdx as any);
      if (val !== undefined) return val;
    }
    
    const unwrappedIdx = Array.isArray(indexVal) ? undefined : this.unwrap(indexVal);
    if (unwrappedIdx !== undefined) {
      if (typeof unwrappedIdx !== "number") {
        throw new Error(`Index must be a number`);
      }
      if (arr.type === "array" || arr.type === "collection" || Array.isArray(arr.value)) {
        const item = arr.value[unwrappedIdx];
        if (item === undefined) {
          if (this.options.allowUnknownIdentifiers) {
            return { type: "number", value: 1 };
          }
          throw new Error(`Index ${unwrappedIdx} out of bounds`);
        }
        return this.wrap(item);
      }
    }
    if (this.options.allowUnknownIdentifiers) {
      return { type: "number", value: 1 };
    }
    throw new Error(`Cannot index into value of type "${arr.type}"`);
  }

  private parseBaseFactor(): TypedValue {
    const token = this.tokens[this.pos];
    this.pos++;

    if (token.startsWith('"') || token.startsWith("'")) {
      return { type: "string", value: token.slice(1, -1) };
    }

    if (token === "(") {
      const result = this.parseExpression();
      if (this.tokens[this.pos++] !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      return result;
    }

    if (token === "-") {
      const factor = this.parseFactor();
      const val = this.unwrap(factor);
      if (typeof val !== "number") {
        throw new Error("Unary minus can only be applied to numbers");
      }
      return { type: "number", value: -val };
    }

    if (token === "!") {
      const factor = this.parseFactor();
      const val = this.unwrap(factor);
      return { type: "boolean", value: !val };
    }

    // Check if it's an identifier (variable or function)
    if (/^[a-zA-Z_]/.test(token)) {
      // Check for function call: identifier followed by '('
      if (this.tokens[this.pos] === "(") {
        this.pos++; // consume '('

        // Special handling for geometry functions (arguments are identifiers, not expressions)
        if (token === "distance" || token === "length" || token === "perimeter" || token === "area" || token === "bbox" || token === "midpoint" || token === "polar" || token === "angleBetween" || token === "width" || token === "height" || token === "minX" || token === "maxX" || token === "minY" || token === "maxY" || token === "pointAt" || token === "closestPoint" || token === "project" || token === "reflect" || token === "toWorld" || token === "toLocal" || token === "intersection" || token === "tangentAt" || token === "normalAt" || token === "frameAt" || token === "tAtLength") {
          const args: string[] = [];

          // Helper: read one geo-function argument token, supporting complex mathematical expressions
          const readGeoArg = (): string => {
            let content = "";
            let depth = 0;
            while (this.pos < this.tokens.length) {
              const next = this.tokens[this.pos];
              if (next === "," && depth === 0) {
                break;
              }
              if (next === ")" && depth === 0) {
                break;
              }
              
              this.pos++; // consume it
              if (next === "(" || next === "[" || next === "{") {
                depth++;
              } else if (next === ")" || next === "]" || next === "}") {
                depth--;
              }
              content += next;
            }
            if (content === "") {
              throw new Error(`Expected argument in geometry function ${token}`);
            }
            return content;
          };

          if (this.tokens[this.pos] !== ")") {
            args.push(readGeoArg());
            while (this.tokens[this.pos] === ",") {
              this.pos++; // consume ','
              args.push(readGeoArg());
            }
          }
          if (this.tokens[this.pos] !== ")") {
            throw new Error(`Expected ')' after geometry function ${token}`);
          }
          this.pos++; // consume ')'

          // Syntax-check mode: just verify the call is structurally valid, return dummy value
          // before requiring a geometry context. The validator's syntax-only
          // pass intentionally has no objects context, but still needs typed,
          // non-zero numeric placeholders to avoid false division-by-zero errors.
          if (this.options.allowUnknownGeometryObjects) {
            if (token === "frameAt") {
              return {
                type: "frame2d" as const,
                value: {
                  point: { x: 0, y: 0 },
                  tangent: { x: 1, y: 0 },
                  normal: { x: 0, y: 1 },
                  angle: 0
                }
              };
            }
            if (token === "bbox") {
              return {
                type: "bbox2d" as const,
                value: {
                  minX: 0,
                  maxX: 0,
                  minY: 0,
                  maxY: 0,
                  width: 0,
                  height: 0
                }
              };
            }
            if (token === "midpoint" || token === "polar" || token === "pointAt" || token === "closestPoint" || token === "project" || token === "reflect" || token === "toWorld" || token === "toLocal" || token === "intersection") {
              return { type: "point" as const, value: { x: 0, y: 0 } };
            }
            // A syntax-only placeholder must not make otherwise valid expressions
            // such as `x / distance(A, B)` fail with division by zero. The real
            // geometry value is unavailable in this pass, so use a neutral,
            // non-zero scalar for numeric geometry queries.
            return { type: "number", value: 1 };
          }

          if (!this.context.objects) {
            throw new Error(`Cannot resolve geometry function "${token}" without objects context`);
          }

          // Helper: look up an object, respecting allowUnknownGeometryObjects flag
          const lookupObj = (id: string, fnName: string) => {
            const o = this.context.objects![id];
            if (o) return o;

            try {
              const nested = new Evaluator(this.context, this.options).evaluate(id);
              if (nested && typeof nested === "object" && "type" in nested) {
                return nested;
              }
            } catch {
              // Fall through to the standard geometry-object error below.
            }

            if (this.options.allowUnknownGeometryObjects) return null;
            throw new Error(`Unknown or invalid object in ${fnName}: ${id}`);
          };

          let computedVal: any;

          if (token === "distance") {
            const obj1 = lookupObj(args[0], "distance");
            const obj2 = lookupObj(args[1], "distance");
            if (!obj1 || !obj2) computedVal = 0;
            else {
              const p1 = this.getPointFromObject(obj1);
              const p2 = this.getPointFromObject(obj2);
              computedVal = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            }
          } else if (token === "length") {
            const obj = lookupObj(args[0], "length");
            if (!obj) computedVal = 0;
            else computedVal = this.getLengthFromObject(obj, args[0]);
          } else if (token === "perimeter") {
            const obj = lookupObj(args[0], "perimeter");
            if (!obj) computedVal = 0;
            else computedVal = this.getPerimeterFromObject(obj, args[0]);
          } else if (token === "area") {
            const obj = lookupObj(args[0], "area");
            if (!obj) computedVal = 0;
            else computedVal = this.getAreaFromObject(obj, args[0]);
          } else if (token === "bbox") {
            const obj = lookupObj(args[0], "bbox");
            if (!obj) {
              return {
                type: "bbox2d" as const,
                value: {
                  minX: 0,
                  maxX: 0,
                  minY: 0,
                  maxY: 0,
                  width: 0,
                  height: 0
                }
              };
            }
            const bbox = this.getBoundingBoxForObject(obj, args[0]);
            return {
              type: "bbox2d" as const,
              value: {
                minX: bbox.x,
                maxX: bbox.x + bbox.width,
                minY: bbox.y,
                maxY: bbox.y + bbox.height,
                width: bbox.width,
                height: bbox.height
              }
            };
          } else if (token === "width") {
            const obj = lookupObj(args[0], "width");
            if (!obj) computedVal = 0;
            else computedVal = this.getBoundingBoxForObject(obj, args[0]).width;
          } else if (token === "height") {
            const obj = lookupObj(args[0], "height");
            if (!obj) computedVal = 0;
            else computedVal = this.getBoundingBoxForObject(obj, args[0]).height;
          } else if (token === "minX") {
            const obj = lookupObj(args[0], "minX");
            if (!obj) computedVal = 0;
            else computedVal = this.getBoundingBoxForObject(obj, args[0]).x;
          } else if (token === "maxX") {
            const obj = lookupObj(args[0], "maxX");
            if (!obj) computedVal = 0;
            else {
              const bbox = this.getBoundingBoxForObject(obj, args[0]);
              computedVal = bbox.x + bbox.width;
            }
          } else if (token === "minY") {
            const obj = lookupObj(args[0], "minY");
            if (!obj) computedVal = 0;
            else computedVal = this.getBoundingBoxForObject(obj, args[0]).y;
          } else if (token === "maxY") {
            const obj = lookupObj(args[0], "maxY");
            if (!obj) computedVal = 0;
            else {
              const bbox = this.getBoundingBoxForObject(obj, args[0]);
              computedVal = bbox.y + bbox.height;
            }
          } else if (token === "midpoint") {
            const p1 = this.resolvePointLikeArg(args[0]);
            const p2 = this.resolvePointLikeArg(args[1]);
            computedVal = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          } else if (token === "polar") {
            const center = this.resolvePointLikeArg(args[0]);
            const subEval = new Evaluator(this.context, this.options);
            const radius = Number(subEval.evaluate(args[1]));
            const angle = Number(subEval.evaluate(args[2]));
            if (Number.isNaN(radius) || Number.isNaN(angle)) {
              throw new Error(`Invalid arguments in polar(${args.join(", ")})`);
            }
            computedVal = {
              x: center.x + radius * Math.cos(angle),
              y: center.y + radius * Math.sin(angle),
            };
          } else if (token === "angleBetween") {
            const p1 = this.resolvePointLikeArg(args[0]);
            const p2 = this.resolvePointLikeArg(args[1]);
            computedVal = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          } else if (token === "pointAt") {
            const obj = lookupObj(args[0], "pointAt");
            if (!obj) computedVal = 0;
            else {
              const subEval = new Evaluator(this.context, this.options);
              const t = Number(subEval.evaluate(args[1]));
      this.validatePathParameter(t, args[0], "pointAt");
              computedVal = this.getPointAtObject(obj, t, args[0]);
            }
          } else if (token === "closestPoint") {
            const refObj = lookupObj(args[0], "closestPoint");
            const targetObj = lookupObj(args[1], "closestPoint");
            if (!refObj || !targetObj) computedVal = 0;
            else computedVal = this.getClosestPoint(this.getPointFromObject(refObj), targetObj, args[1]);
          } else if (token === "project") {
            const point = this.resolvePointLikeArg(args[0]);
            const targetObj = lookupObj(args[1], "project");
            if (!targetObj) computedVal = 0;
            else computedVal = this.projectPointToLine(point, targetObj, args[1]);
          } else if (token === "reflect") {
            const point = this.resolvePointLikeArg(args[0]);
            const targetObj = lookupObj(args[1], "reflect");
            if (!targetObj) computedVal = 0;
            else computedVal = this.reflectPointAgainstTarget(point, targetObj, args[1]);
          } else if (token === "toWorld") {
            const point = this.resolvePointLikeArg(args[0]);
            computedVal = this.transformPointForObject(point, args[1], "world");
          } else if (token === "toLocal") {
            const point = this.resolvePointLikeArg(args[0]);
            computedVal = this.transformPointForObject(point, args[1], "local");
          } else if (token === "tangentAt") {
            const obj = lookupObj(args[0], "tangentAt");
            if (!obj) computedVal = 0;
            else {
              const subEval = new Evaluator(this.context, this.options);
              const t = Number(subEval.evaluate(args[1]));
              this.validatePathParameter(t, args[0], "tangentAt");
              computedVal = this.getTangentAtObject(obj, t, args[0]);
            }
          } else if (token === "normalAt") {
            const obj = lookupObj(args[0], "normalAt");
            if (!obj) computedVal = 0;
            else {
              const subEval = new Evaluator(this.context, this.options);
              const t = Number(subEval.evaluate(args[1]));
              this.validatePathParameter(t, args[0], "normalAt");
              computedVal = this.getNormalAtObject(obj, t, args[0]);
            }
          } else if (token === "frameAt") {
            const obj = lookupObj(args[0], "frameAt");
            if (!obj) {
              return {
                type: "frame2d" as const,
                value: {
                  point: { x: 0, y: 0 },
                  tangent: { x: 1, y: 0 },
                  normal: { x: 0, y: 1 },
                  angle: 0
                }
              };
            } else {
              const subEval = new Evaluator(this.context, this.options);
              const t = Number(subEval.evaluate(args[1]));
              if (!Number.isFinite(t)) throw new Error(`FRAME_RESOLUTION_FAILED: parameter t must be finite, got ${t}`);
              if (t < 0 || t > 1) {
                throw new Error(`FRAME_RESOLUTION_FAILED: parameter t must be between 0 and 1, got ${t}`);
              }
              const point = this.getPointAtObject(obj, t, args[0]);
              const tangent = this.getTangentAtObject(obj, t, args[0]);
              const normal = this.getNormalAtObject(obj, t, args[0]);
              const angle = Math.atan2(tangent.y, tangent.x);
              return {
                type: "frame2d" as const,
                value: {
                  point,
                  tangent,
                  normal,
                  angle
                }
              };
            }
          } else if (token === "tAtLength") {
            const obj = lookupObj(args[0], "tAtLength");
            if (!obj) computedVal = 0;
            else {
              const subEval = new Evaluator(this.context, this.options);
              const targetLen = Number(subEval.evaluate(args[1]));
              if (Number.isNaN(targetLen)) throw new Error(`Invalid parameter targetLength in tAtLength: ${args[1]}`);
              computedVal = this.getTAtLengthFromObject(obj, targetLen, args[0]);
            }
          } else if (token === "intersection") {
            if (args.length < 2) throw new Error(`intersection() requires at least 2 arguments`);
            const obj1 = lookupObj(args[0], "intersection");
            const obj2 = lookupObj(args[1], "intersection");
            if (!obj1 || !obj2) computedVal = 0;
            else {
              const label = `intersection(${args[0]}, ${args[1]})`;
              const candidates = computeIntersections(obj1, obj2, label);

              // Parse optional selector (3rd arg)
              let selector: IntersectionSelector | undefined;
              if (args.length >= 3) {
                const raw = args[2];
                if (raw === "first" || raw === "last") {
                  selector = raw;
                } else if (/^\d+$/.test(raw)) {
                  selector = { index: parseInt(raw, 10) };
                } else if (raw.startsWith("nearest(") && raw.endsWith(")")) {
                  const refId = raw.slice(8, -1);
                  const refObj = this.context.objects[refId];
                  if (!refObj) throw new Error(`Unknown reference in nearest(): ${refId}`);
                  selector = { nearest: this.getPointFromObject(refObj) };
                } else if (raw.startsWith("farthest(") && raw.endsWith(")")) {
                  const refId = raw.slice(9, -1);
                  const refObj = this.context.objects[refId];
                  if (!refObj) throw new Error(`Unknown reference in farthest(): ${refId}`);
                  selector = { farthest: this.getPointFromObject(refObj) };
                } else if (raw.startsWith("{") && raw.endsWith("}")) {
                  // Support {index: n}
                  const match = raw.match(/\{\s*index\s*:\s*(\d+)\s*\}/);
                  if (match) {
                    selector = { index: parseInt(match[1], 10) };
                  } else {
                    throw new Error(`Unsupported object selector: "${raw}"`);
                  }
                } else {
                  throw new Error(`Unknown intersection selector: "${raw}"`);
                }
              }

              computedVal = applySelector(candidates, selector, label);
            }
          }

          return this.wrap(computedVal);
        }

        // Standard math functions
        const args: TypedValue[] = [];
        if (this.tokens[this.pos] !== ")") {
          args.push(this.parseExpression());
          while (this.tokens[this.pos] === ",") {
            this.pos++; // consume ','
            args.push(this.parseExpression());
          }
        }

        if (this.tokens[this.pos] !== ")") {
          throw new Error(`Expected ')' after function arguments for ${token}`);
        }
        this.pos++; // consume ')'

        const unwrappedArgs = args.map((a) => this.unwrap(a));

        switch (token) {
          case "min": return { type: "number", value: Math.min(...unwrappedArgs) };
          case "max": return { type: "number", value: Math.max(...unwrappedArgs) };
          case "abs": return { type: "number", value: Math.abs(unwrappedArgs[0] || 0) };
          case "clamp": return { type: "number", value: Math.min(Math.max(unwrappedArgs[0] || 0, unwrappedArgs[1] || 0), unwrappedArgs[2] || 0) };
          case "sin": return { type: "number", value: Math.sin(unwrappedArgs[0] || 0) };
          case "cos": return { type: "number", value: Math.cos(unwrappedArgs[0] || 0) };
          case "tan": return { type: "number", value: Math.tan(unwrappedArgs[0] || 0) };
          case "sqrt": return { type: "number", value: Math.sqrt(unwrappedArgs[0] || 0) };
          case "pow": return { type: "number", value: Math.pow(unwrappedArgs[0] || 0, unwrappedArgs[1] || 0) };
          case "round": return { type: "number", value: Math.round(unwrappedArgs[0] || 0) };
          case "floor": return { type: "number", value: Math.floor(unwrappedArgs[0] || 0) };
          case "ceil": return { type: "number", value: Math.ceil(unwrappedArgs[0] || 0) };
          case "concat": return { type: "string", value: unwrappedArgs.map(String).join("") };
          case "charAt": {
            const str = String(unwrappedArgs[0] || "");
            const idx = Math.floor(Number(unwrappedArgs[1]) || 0);
            return { type: "string", value: str.charAt(idx) };
          }
          case "format": {
            let fmt = String(unwrappedArgs[0] || "");
            for (let i = 1; i < unwrappedArgs.length; i++) {
              fmt = fmt.replace(`{${i - 1}}`, String(unwrappedArgs[i] !== undefined ? unwrappedArgs[i] : ""));
            }
            return { type: "string", value: fmt };
          }
          default: {
            if (this.context.callFunction) {
              const res = this.context.callFunction(token, args);
              if (res !== undefined) return res;
            }
            throw new Error(`Unknown function: ${token}`);
          }
        }
      }

      // 1. Dynamic Hook Resolution (Priority)
      if (this.context.get) {
        const val = this.context.get(token);
        if (val !== undefined) return val;
      }
      const reconstructed = this.tryReconstructAndResolve(token);
      if (reconstructed !== undefined) {
        const next = this.tokens[this.pos];
        if (["+", "-", "*", "/"].includes(next) && typeof reconstructed.value !== "number") {
          throw new Error(`Identifier "${reconstructed.value}" does not resolve to a number`);
        }
        return reconstructed;
      }
      if (this.context.resolveIdentifier) {
        const resolved = this.context.resolveIdentifier(token);
        if (resolved !== undefined) {
           const next = this.tokens[this.pos];
           if (["+", "-", "*", "/"].includes(next) && typeof resolved !== "number") {
                throw new Error(`Identifier "${token}" does not resolve to a number`);
           }
           return this.wrap(resolved);
        }
      }

      // 2. Scalar Resolution
      if (this.context.scalars && this.context.scalars[token] !== undefined) {
        return this.wrap(this.context.scalars[token]);
      }

      // 3. Object Context Lookup (e.g. to be evaluated via MemberAccess)
      if (this.context.objects && this.context.objects[token] !== undefined) {
        return { type: "object", value: this.context.objects[token] };
      }

      // 4. Fallback/Unknown
      if (this.options.allowUnknownIdentifiers) {
        return { type: "number", value: 1 };
      }
      throw new Error(`Unknown identifier: ${token}. Available scalars: ${Object.keys(this.context.scalars || {}).join(", ")}`);
    }

    // It's a number or unit literal
    if (/^\d+(?:\.\d+)?(?:deg|rad)$/.test(token)) {
      const val = parseFloat(token);
      return { type: "number", value: token.endsWith("deg") ? val * (Math.PI / 180) : val };
    }

    if (/^\d+(?:\.\d+)?[a-zA-Z%]+$/.test(token)) {
      return { type: "length", value: normalizeUnit(token, this.context.targetUnit) };
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      return { type: "number", value: parseFloat(token) };
    }

    throw new Error(`Invalid token: ${token}`);
  }

  private getPointFromObject(obj: any): { x: number; y: number } {
    if (obj.type === "point") return { x: obj.x, y: obj.y };
    if (obj.type === "rect") return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
    if (obj.type === "circle") return { x: obj.cx, y: obj.cy };
    if (obj.type === "ellipse") return { x: obj.cx, y: obj.cy };
    if (obj.type === "arc") return { x: obj.cx, y: obj.cy };
    if (obj.type === "line") return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
    const bbox = this.tryGetBoundingBoxForObject(obj, obj?.id ?? obj?.type ?? "object");
    if (bbox) return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    return { x: 0, y: 0 };
  }

  private resolvePointLikeArg(arg: string): { x: number; y: number } {
    if (this.context.resolveIdentifier) {
      const resolved = this.context.resolveIdentifier(arg);
      if (resolved && typeof resolved === "object" && "x" in (resolved as any) && "y" in (resolved as any)) {
        return resolved as { x: number; y: number };
      }
    }

    if (!this.context.objects) {
      throw new Error(`Cannot resolve point-like argument: ${arg}`);
    }

    const obj = this.context.objects[arg];
    if (!obj) throw new Error(`Unknown object in point-like argument: ${arg}`);
    return this.getPointFromObject(obj);
  }

  private isGeometryOperationObject(obj: any): boolean {
    return (
      obj?.type === "translate" ||
      obj?.type === "rotate" ||
      obj?.type === "scale" ||
      obj?.type === "mirror" ||
      obj?.type === "reverse"
    );
  }

  private getGeometryOperationTarget(obj: any, label: string): any {
    if (!this.context.objects || !obj?.target) {
      throw new Error(`Operation object "${label}" does not expose a resolvable target`);
    }
    const target = this.context.objects[obj.target];
    if (!target) {
      throw new Error(`Operation target "${obj.target}" not found for "${label}"`);
    }
    return target;
  }

  private applyGeometryOperationPoint(point: { x: number; y: number }, obj: any): { x: number; y: number } {
    if (!obj?.transform?.length) return point;
    return applyTransformPipeline(point, obj.transform as any);
  }

  private getGeometryOperationPointAt(obj: any, t: number, label: string): { x: number; y: number } {
    const target = this.getGeometryOperationTarget(obj, label);
    const point = this.getPointAtObject(target, obj.type === "reverse" ? 1 - t : t, obj.target);
    return this.applyGeometryOperationPoint(point, obj);
  }

  private validatePathParameter(t: number, label: string, query: string): void {
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      throw new Error(`INVALID_VALUE: ${query} parameter t must be between 0 and 1, got ${t} for "${label}"`);
    }
  }

  private getLengthFromObject(obj: any, label: string): number {
    if (this.isGeometryOperationObject(obj)) {
      const target = this.getGeometryOperationTarget(obj, label);
      if (obj.type !== "scale") {
        return this.getLengthFromObject(target, obj.target);
      }
      let total = 0;
      let prev = this.getGeometryOperationPointAt(obj, 0, label);
      const steps = 64;
      for (let i = 1; i <= steps; i++) {
        const next = this.getGeometryOperationPointAt(obj, i / steps, label);
        total += Math.hypot(next.x - prev.x, next.y - prev.y);
        prev = next;
      }
      return total;
    }

    if (obj.type === "line") {
      return Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1);
    }
    if (obj.type === "rect") {
      return 2 * (obj.width + obj.height);
    }
    if (obj.type === "circle") {
      return 2 * Math.PI * obj.radius;
    }
    if (obj.type === "ellipse") {
      const h = Math.pow(obj.rx - obj.ry, 2) / Math.pow(obj.rx + obj.ry, 2);
      return Math.PI * (obj.rx + obj.ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    }
    if (obj.type === "arc") {
      if (obj.radius === undefined || obj.startAngle === undefined || obj.endAngle === undefined) {
        throw new Error(`Arc "${label}" does not expose a resolvable length`);
      }
      return obj.radius * Math.abs(obj.endAngle - obj.startAngle);
    }
    if (obj.type === "quadratic") {
      return this.approximateQuadraticLength(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cpx, y: obj.cpy },
        { x: obj.x2, y: obj.y2 }
      );
    }
    if (obj.type === "cubic") {
      return this.approximateCubicLength(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cp1x, y: obj.cp1y },
        { x: obj.cp2x, y: obj.cp2y },
        { x: obj.x2, y: obj.y2 }
      );
    }
    if (obj.type === "path") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return obj.segments.reduce((total: number, segment: any) => {
          if (segment.type === "line") {
            return total + Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
          }
          if (segment.type === "arc") {
            if (segment.radius === undefined) return total;
            const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
            let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
            if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
            if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;
            return total + segment.radius * Math.abs(endAngle - startAngle);
          }
          if (segment.type === "quadratic") {
            return total + this.approximateQuadraticLength(
              { x: segment.x1, y: segment.y1 },
              { x: segment.cpx, y: segment.cpy },
              { x: segment.x2, y: segment.y2 }
            );
          }
          if (segment.type === "cubic") {
            return total + this.approximateCubicLength(
              { x: segment.x1, y: segment.y1 },
              { x: segment.cp1x, y: segment.cp1y },
              { x: segment.cp2x, y: segment.cp2y },
              { x: segment.x2, y: segment.y2 }
            );
          }
          return total;
        }, 0);
      }
      if (Array.isArray(obj.points)) {
        return this.polylineLength(obj.points, obj.closed === true);
      }
    }
    if (obj.type === "polygon") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return obj.segments.reduce((total: number, segment: any) => {
          if (segment.type === "line") {
            return total + Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
          }
          if (segment.type === "arc") {
            if (segment.radius === undefined) return total;
            const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
            let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
            if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
            if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;
            return total + segment.radius * Math.abs(endAngle - startAngle);
          }
          if (segment.type === "quadratic") {
            return total + this.approximateQuadraticLength(
              { x: segment.x1, y: segment.y1 },
              { x: segment.cpx, y: segment.cpy },
              { x: segment.x2, y: segment.y2 }
            );
          }
          if (segment.type === "cubic") {
            return total + this.approximateCubicLength(
              { x: segment.x1, y: segment.y1 },
              { x: segment.cp1x, y: segment.cp1y },
              { x: segment.cp2x, y: segment.cp2y },
              { x: segment.x2, y: segment.y2 }
            );
          }
          return total;
        }, 0);
      }
      if (Array.isArray(obj.points)) {
        return this.polylineLength(obj.points, true);
      }
    }
    throw new Error(`PATH_LENGTH_UNAVAILABLE: Unknown or invalid object in length: ${label}`);
  }

  private getPerimeterFromObject(obj: any, label: string): number {
    if (obj.type === "rect" || obj.type === "circle" || obj.type === "ellipse" || obj.type === "polygon") {
      return this.getLengthFromObject(obj, label) + this.getHolePerimeter(obj, label);
    }
    if (obj.type === "path") {
      if (!obj.closed) {
        throw new Error(`Path "${label}" must be closed to expose perimeter`);
      }
      return this.getLengthFromObject(obj, label) + this.getHolePerimeter(obj, label);
    }
    if (obj.type === "boolean") {
      return this.getLengthFromObject(obj, label) + this.getHolePerimeter(obj, label);
    }
    if (this.isGeometryOperationObject(obj)) {
      return this.getLengthFromObject(obj, label);
    }
    throw new Error(`Unknown or invalid object in perimeter: ${label}`);
  }

  private getAreaFromObject(obj: any, label: string): number {
    if (this.isGeometryOperationObject(obj)) {
      const target = this.getGeometryOperationTarget(obj, label);
      const baseArea = this.getAreaFromObject(target, obj.target);
      if (obj.type !== "scale") return baseArea;
      const scaleOp = obj.transform?.find((entry: any) => entry.type === "scale");
      if (!scaleOp) return baseArea;
      return baseArea * Math.abs(scaleOp.factor[0] * scaleOp.factor[1]);
    }

    if (obj.type === "rect") return this.subtractHoleArea(obj.width * obj.height, obj);
    if (obj.type === "circle") return this.subtractHoleArea(Math.PI * obj.radius * obj.radius, obj);
    if (obj.type === "ellipse") return this.subtractHoleArea(Math.PI * obj.rx * obj.ry, obj);
    if (obj.type === "polygon") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return this.subtractHoleArea(this.areaFromClosedSegments(obj.segments), obj);
      }
      return this.subtractHoleArea(this.polygonArea(obj.points ?? []), obj);
    }
    if (obj.type === "path") {
      if (!obj.closed) {
        throw new Error(`Path "${label}" must be closed to expose area`);
      }
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return this.subtractHoleArea(this.areaFromClosedSegments(obj.segments), obj);
      }
      return this.subtractHoleArea(this.polygonArea(obj.points ?? []), obj);
    }
    if (obj.type === "boolean") {
      const baseArea = Array.isArray(obj.segments) && obj.segments.length > 0
        ? this.areaFromClosedSegments(obj.segments)
        : this.polygonArea(obj.points ?? []);
      return this.subtractHoleArea(baseArea, obj);
    }
    throw new Error(`Unknown or invalid object in area: ${label}`);
  }

  private tryGetBoundingBoxForObject(obj: any, label: string) {
    try {
      return this.getBoundingBoxForObject(obj, label);
    } catch {
      return null;
    }
  }

  private getBoundingBoxForObject(obj: any, label: string): { x: number; y: number; width: number; height: number } {
    if (typeof obj?.x === "number" && typeof obj?.y === "number" && typeof obj?.width === "number" && typeof obj?.height === "number") {
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    }

    if (obj.type === "point") {
      return { x: obj.x, y: obj.y, width: 0, height: 0 };
    }
    if (obj.type === "circle") {
      return { x: obj.cx - obj.radius, y: obj.cy - obj.radius, width: obj.radius * 2, height: obj.radius * 2 };
    }
    if (obj.type === "ellipse") {
      const samples = this.sampleObjectBoundaryPoints(obj, label, 96);
      return this.bboxFromPoints(samples);
    }
    if (obj.type === "line") {
      return this.bboxFromPoints([{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }]);
    }
    if (obj.type === "arc" || obj.type === "quadratic" || obj.type === "cubic" || obj.type === "path" || obj.type === "polygon") {
      const samples = this.sampleObjectBoundaryPoints(obj, label, 96);
      return this.bboxFromPoints(samples);
    }
    if (this.isGeometryOperationObject(obj)) {
      const samples = this.sampleObjectBoundaryPoints(obj, label, 96);
      return this.bboxFromPoints(samples);
    }
    throw new Error(`Unknown or invalid object in bbox query: ${label}`);
  }

  private getPointAtObject(obj: any, t: number, label: string): { x: number; y: number } {
    const clamped = Math.min(Math.max(t, 0), 1);

    if (this.isGeometryOperationObject(obj)) {
      return this.getGeometryOperationPointAt(obj, clamped, label);
    }

    if (obj.type === "line") {
      return this.lerpPoint({ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }, clamped);
    }

    if (obj.type === "circle") {
      const angle = clamped * Math.PI * 2;
      return {
        x: obj.cx + obj.radius * Math.cos(angle),
        y: obj.cy + obj.radius * Math.sin(angle),
      };
    }
    if (obj.type === "ellipse") {
      const angle = clamped * Math.PI * 2;
      const localX = obj.rx * Math.cos(angle);
      const localY = obj.ry * Math.sin(angle);
      const rotation = obj.rotation ?? 0;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      return {
        x: obj.cx + localX * cos - localY * sin,
        y: obj.cy + localX * sin + localY * cos,
      };
    }
    if (obj.type === "rect") {
      const p = clamped * (2 * (obj.width + obj.height));
      if (p <= obj.width) return { x: obj.x + p, y: obj.y };
      if (p <= obj.width + obj.height) return { x: obj.x + obj.width, y: obj.y + (p - obj.width) };
      if (p <= 2 * obj.width + obj.height) return { x: obj.x + obj.width - (p - (obj.width + obj.height)), y: obj.y + obj.height };
      return { x: obj.x, y: obj.y + obj.height - (p - (2 * obj.width + obj.height)) };
    }
    if (obj.type === "arc") {
      if (
        obj.cx === undefined ||
        obj.cy === undefined ||
        obj.radius === undefined ||
        obj.startAngle === undefined ||
        obj.endAngle === undefined
      ) {
        throw new Error(`Arc "${label}" does not expose a resolvable pointAt`);
      }
      const angle = obj.startAngle + (obj.endAngle - obj.startAngle) * clamped;
      return {
        x: obj.cx + obj.radius * Math.cos(angle),
        y: obj.cy + obj.radius * Math.sin(angle),
      };
    }
    if (obj.type === "quadratic") {
      return this.pointOnQuadratic(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cpx, y: obj.cpy },
        { x: obj.x2, y: obj.y2 },
        clamped
      );
    }
    if (obj.type === "cubic") {
      return this.pointOnCubic(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cp1x, y: obj.cp1y },
        { x: obj.cp2x, y: obj.cp2y },
        { x: obj.x2, y: obj.y2 },
        clamped
      );
    }
    if (obj.type === "path") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return this.pointAtSegments(obj.segments, clamped, label);
      }
      if (Array.isArray(obj.points) && obj.points.length > 1) {
        return this.pointAtPolyline(obj.points, clamped, label, obj.closed === true);
      }
    }
    if (obj.type === "polygon") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        return this.pointAtSegments(obj.segments, clamped, label);
      }
      if (Array.isArray(obj.points) && obj.points.length > 1) {
        return this.pointAtPolyline(obj.points, clamped, label, true);
      }
    }
    throw new Error(`Unknown or invalid object in pointAt: ${label}`);
  }

  private getTangentAtObject(obj: any, t: number, label: string): { x: number; y: number } {
    const length = this.getLengthFromObject(obj, label);
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(`TANGENT_NOT_FOUND: Path "${label}" has zero length`);
    }
    const clamped = Math.min(Math.max(t, 0), 1);
    const EPS = 1e-6;

    if (this.isGeometryOperationObject(obj)) {
      if (obj.type === "reverse") {
        const target = this.getGeometryOperationTarget(obj, label);
        const tangent = this.getTangentAtObject(target, 1 - clamped, obj.target);
        return { x: -tangent.x, y: -tangent.y };
      }
      const t0 = Math.max(0, clamped - EPS);
      const t1 = Math.min(1, clamped + EPS);
      const p0 = this.getGeometryOperationPointAt(obj, t0, label);
      const p1 = this.getGeometryOperationPointAt(obj, t1, label);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }

    if (obj.type === "line") {
      const dx = obj.x2 - obj.x1;
      const dy = obj.y2 - obj.y1;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    if (obj.type === "arc") {
      if (obj.cx === undefined || obj.cy === undefined || obj.startAngle === undefined || obj.endAngle === undefined) {
        throw new Error(`Arc "${label}" does not expose a resolvable tangentAt`);
      }
      const angle = obj.startAngle + (obj.endAngle - obj.startAngle) * clamped;
      const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
      // Reverse if arc goes clockwise (endAngle < startAngle)
      if (obj.endAngle < obj.startAngle) return { x: -tangent.x, y: -tangent.y };
      return tangent;
    }
    // For curves and segmented paths, use numerical differentiation
    const t0 = Math.max(0, clamped - EPS);
    const t1 = Math.min(1, clamped + EPS);
    const p0 = this.getPointAtObject(obj, t0, label);
    const p1 = this.getPointAtObject(obj, t1, label);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  private getNormalAtObject(obj: any, t: number, label: string): { x: number; y: number } {
    const tangent = this.getTangentAtObject(obj, t, label);
    // Rotate 90° CCW: (dx, dy) → (-dy, dx)
    return { x: -tangent.y, y: tangent.x };
  }

  private getTAtLengthFromObject(obj: any, targetLen: number, label: string): number {
    const totalLen = this.getLengthFromObject(obj, label);
    if (totalLen === 0) {
      throw new Error(`PATH_LENGTH_UNAVAILABLE: Path length is zero or unavailable for object "${label}"`);
    }
    if (targetLen < 0 || targetLen > totalLen) {
      throw new Error(`INVALID_T_AT_LENGTH: targetLength must be between 0 and total length (${totalLen}), got ${targetLen}`);
    }
    if (targetLen === 0) return 0;
    if (targetLen === totalLen) return 1;

    let low = 0;
    let high = 1;
    for (let iter = 0; iter < 16; iter++) {
      const mid = (low + high) / 2;
      const subLen = this.getSubLengthFromObject(obj, mid, label);
      if (subLen < targetLen) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  }

  private getSubLengthFromObject(obj: any, t: number, label: string): number {
    if (t <= 0) return 0;
    if (t >= 1) return this.getLengthFromObject(obj, label);

    if (obj.type === "line" || obj.type === "arc" || obj.type === "circle") {
      return t * this.getLengthFromObject(obj, label);
    }

    if (obj.type === "quadratic") {
      return this.approximateSubQuadraticLength(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cpx, y: obj.cpy },
        { x: obj.x2, y: obj.y2 },
        t
      );
    }

    if (obj.type === "cubic") {
      return this.approximateSubCubicLength(
        { x: obj.x1, y: obj.y1 },
        { x: obj.cp1x, y: obj.cp1y },
        { x: obj.cp2x, y: obj.cp2y },
        { x: obj.x2, y: obj.y2 },
        t
      );
    }

    let total = 0;
    let prev = this.getPointAtObject(obj, 0, label);
    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const currT = (i / steps) * t;
      const next = this.getPointAtObject(obj, currT, label);
      total += Math.hypot(next.x - prev.x, next.y - prev.y);
      prev = next;
    }
    return total;
  }

  private approximateSubQuadraticLength(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p1: { x: number; y: number },
    t: number,
    steps = 24
  ): number {
    let total = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const currT = (i / steps) * t;
      const mt = 1 - currT;
      const next = {
        x: mt * mt * p0.x + 2 * mt * currT * cp.x + currT * currT * p1.x,
        y: mt * mt * p0.y + 2 * mt * currT * cp.y + currT * currT * p1.y,
      };
      total += Math.hypot(next.x - prev.x, next.y - prev.y);
      prev = next;
    }
    return total;
  }

  private approximateSubCubicLength(
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p1: { x: number; y: number },
    t: number,
    steps = 32
  ): number {
    let total = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const currT = (i / steps) * t;
      const mt = 1 - currT;
      const next = {
        x:
          mt * mt * mt * p0.x +
          3 * mt * mt * currT * cp1.x +
          3 * mt * currT * currT * cp2.x +
          currT * currT * currT * p1.x,
        y:
          mt * mt * mt * p0.y +
          3 * mt * mt * currT * cp1.y +
          3 * mt * currT * currT * cp2.y +
          currT * currT * currT * p1.y,
      };
      total += Math.hypot(next.x - prev.x, next.y - prev.y);
      prev = next;
    }
    return total;
  }

  private getClosestPoint(ref: { x: number; y: number }, obj: any, label: string): { x: number; y: number } {
    if (obj.type === "point") {
      return { x: obj.x, y: obj.y };
    }
    if (obj.type === "line") {
      return this.closestPointOnSegment(ref, { x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 });
    }
    if (obj.type === "circle") {
      const dx = ref.x - obj.cx;
      const dy = ref.y - obj.cy;
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: obj.cx + (dx / len) * obj.radius,
        y: obj.cy + (dy / len) * obj.radius,
      };
    }
    if (obj.type === "arc") {
      if (
        obj.cx === undefined ||
        obj.cy === undefined ||
        obj.radius === undefined ||
        obj.startAngle === undefined ||
        obj.endAngle === undefined
      ) {
        throw new Error(`Arc "${label}" does not expose a resolvable closestPoint`);
      }
      const rawAngle = Math.atan2(ref.y - obj.cy, ref.x - obj.cx);
      const angle = this.clampAngleToArc(rawAngle, obj.startAngle, obj.endAngle);
      const projected = {
        x: obj.cx + obj.radius * Math.cos(angle),
        y: obj.cy + obj.radius * Math.sin(angle),
      };
      const start = { x: obj.cx + obj.radius * Math.cos(obj.startAngle), y: obj.cy + obj.radius * Math.sin(obj.startAngle) };
      const end = { x: obj.cx + obj.radius * Math.cos(obj.endAngle), y: obj.cy + obj.radius * Math.sin(obj.endAngle) };
      const candidates = [projected, start, end];
      return this.pickNearestPoint(ref, candidates);
    }
    if (obj.type === "quadratic") {
      return this.closestPointOnQuadratic(
        ref,
        { x: obj.x1, y: obj.y1 },
        { x: obj.cpx, y: obj.cpy },
        { x: obj.x2, y: obj.y2 }
      );
    }
    if (obj.type === "cubic") {
      return this.closestPointOnCubic(
        ref,
        { x: obj.x1, y: obj.y1 },
        { x: obj.cp1x, y: obj.cp1y },
        { x: obj.cp2x, y: obj.cp2y },
        { x: obj.x2, y: obj.y2 }
      );
    }
    if (obj.type === "path") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        const points = obj.segments.map((segment: any) => this.closestPointOnSegmentLike(ref, segment));
        return this.pickNearestPoint(ref, points);
      }
      if (Array.isArray(obj.points) && obj.points.length > 1) {
        return this.closestPointOnPointPath(ref, obj.points, obj.closed === true);
      }
    }
    if (obj.type === "polygon") {
      if (Array.isArray(obj.segments) && obj.segments.length > 0) {
        const points = obj.segments.map((segment: any) => this.closestPointOnSegmentLike(ref, segment));
        return this.pickNearestPoint(ref, points);
      }
      const points = obj.points ?? [];
      if (points.length > 1) {
        return this.closestPointOnPointPath(ref, points, true);
      }
    }
    throw new Error(`Unknown or invalid object in closestPoint: ${label}`);
  }

  private projectPointToLine(
    point: { x: number; y: number },
    obj: any,
    label: string
  ): { x: number; y: number } {
    if (obj.type !== "line") {
      throw new Error(`project() requires a line target, got ${obj.type ?? label}`);
    }
    const ax = obj.x1;
    const ay = obj.y1;
    const bx = obj.x2;
    const by = obj.y2;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      return { x: ax, y: ay };
    }
    const t = ((point.x - ax) * dx + (point.y - ay) * dy) / len2;
    return { x: ax + t * dx, y: ay + t * dy };
  }

  private reflectPointAgainstTarget(
    point: { x: number; y: number },
    obj: any,
    label: string
  ): { x: number; y: number } {
    if (obj.type === "point") {
      return {
        x: obj.x * 2 - point.x,
        y: obj.y * 2 - point.y,
      };
    }
    if (obj.type === "line") {
      const projected = this.projectPointToLine(point, obj, label);
      return {
        x: projected.x * 2 - point.x,
        y: projected.y * 2 - point.y,
      };
    }
    throw new Error(`reflect() requires a point or line target, got ${obj.type ?? label}`);
  }

  private pointAtPolyline(points: { x: number; y: number }[], t: number, label: string, closed = false) {
    const total = this.polylineLength(points, closed);
    if (total <= 0) throw new Error(`Path "${label}" has zero length`);
    let remaining = total * t;

    const segmentCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (remaining <= segmentLength || i === segmentCount - 1) {
        const localT = segmentLength === 0 ? 0 : remaining / segmentLength;
        return this.lerpPoint(a, b, localT);
      }
      remaining -= segmentLength;
    }

    return closed ? points[0] : points[points.length - 1];
  }

  private pointAtSegments(segments: any[], t: number, label: string) {
    const lengths = segments.map((segment) => this.getLengthFromObject(segment, label));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (total <= 0) throw new Error(`Path "${label}" has zero length`);

    let remaining = total * t;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentLength = lengths[i];
      if (remaining <= segmentLength || i === segments.length - 1) {
        const localT = segmentLength === 0 ? 0 : remaining / segmentLength;
        if (segment.type === "line") {
          return this.lerpPoint({ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }, localT);
        }
        if (segment.type === "arc") {
          const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
          let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
          if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
          if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;
          const angle = startAngle + (endAngle - startAngle) * localT;
          return {
            x: segment.cx + segment.radius * Math.cos(angle),
            y: segment.cy + segment.radius * Math.sin(angle),
          };
        }
        if (segment.type === "quadratic") {
          return this.pointOnQuadratic(
            { x: segment.x1, y: segment.y1 },
            { x: segment.cpx, y: segment.cpy },
            { x: segment.x2, y: segment.y2 },
            localT
          );
        }
        if (segment.type === "cubic") {
          return this.pointOnCubic(
            { x: segment.x1, y: segment.y1 },
            { x: segment.cp1x, y: segment.cp1y },
            { x: segment.cp2x, y: segment.cp2y },
            { x: segment.x2, y: segment.y2 },
            localT
          );
        }
      }
      remaining -= segmentLength;
    }

    const last = segments[segments.length - 1];
    return { x: last.x2, y: last.y2 };
  }

  private lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }

  private closestPointOnSegment(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return a;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / ab2));
    return this.lerpPoint(a, b, t);
  }

  private closestPointOnQuadratic(
    ref: { x: number; y: number },
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 48
  ) {
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      samples.push(this.pointOnQuadratic(p0, cp, p1, i / steps));
    }
    return this.pickNearestPoint(ref, samples);
  }

  private closestPointOnCubic(
    ref: { x: number; y: number },
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 64
  ) {
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      samples.push(this.pointOnCubic(p0, cp1, cp2, p1, i / steps));
    }
    return this.pickNearestPoint(ref, samples);
  }

  private closestPointOnSegmentLike(ref: { x: number; y: number }, segment: any) {
    if (segment.type === "line") {
      return this.closestPointOnSegment(ref, { x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
    }
    if (segment.type === "arc") {
      return this.getClosestPoint(ref, { ...segment, type: "arc", startAngle: Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx), endAngle: Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx) }, "segment");
    }
    if (segment.type === "quadratic") {
      return this.closestPointOnQuadratic(ref, { x: segment.x1, y: segment.y1 }, { x: segment.cpx, y: segment.cpy }, { x: segment.x2, y: segment.y2 });
    }
    return this.closestPointOnCubic(
      ref,
      { x: segment.x1, y: segment.y1 },
      { x: segment.cp1x, y: segment.cp1y },
      { x: segment.cp2x, y: segment.cp2y },
      { x: segment.x2, y: segment.y2 }
    );
  }

  private pickNearestPoint(ref: { x: number; y: number }, points: { x: number; y: number }[]) {
    let best = points[0];
    let bestDist = this.distanceSquared(ref, best);
    for (let i = 1; i < points.length; i++) {
      const dist = this.distanceSquared(ref, points[i]);
      if (dist < bestDist) {
        bestDist = dist;
        best = points[i];
      }
    }
    return best;
  }

  private distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  private clampAngleToArc(angle: number, start: number, end: number) {
    const normalize = (value: number) => {
      const fullTurn = Math.PI * 2;
      let current = value % fullTurn;
      if (current < 0) current += fullTurn;
      return current;
    };

    const a = normalize(angle);
    const s = normalize(start);
    let e = normalize(end);
    if (e < s) e += Math.PI * 2;
    const candidates = [a, a + Math.PI * 2, a - Math.PI * 2];
    const inRange = candidates.find((candidate) => candidate >= s && candidate <= e);
    if (inRange !== undefined) return inRange;
    return Math.abs(candidates[0] - s) < Math.abs(candidates[0] - e) ? s : e;
  }

  private pointOnQuadratic(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p1: { x: number; y: number },
    t: number
  ) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
    };
  }

  private pointOnCubic(
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p1: { x: number; y: number },
    t: number
  ) {
    const mt = 1 - t;
    return {
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * cp1.x +
        3 * mt * t * t * cp2.x +
        t * t * t * p1.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * cp1.y +
        3 * mt * t * t * cp2.y +
        t * t * t * p1.y,
    };
  }

  private polylineLength(points: { x: number; y: number }[], closed = false): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (closed && points.length > 1) {
      total += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
    }
    return total;
  }

  private closestPointOnPointPath(
    ref: { x: number; y: number },
    points: { x: number; y: number }[],
    closed: boolean
  ) {
    const candidates: { x: number; y: number }[] = [];
    const segmentCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      candidates.push(this.closestPointOnSegment(ref, a, b));
    }
    return this.pickNearestPoint(ref, candidates);
  }

  private polygonArea(points: { x: number; y: number }[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  private areaFromSegments(segments: any[]): number {
    const points = this.sampleSegmentsAsPolyline(segments);
    return this.polygonArea(points);
  }

  private areaFromClosedSegments(segments: any[]): number {
    let total = 0;
    let loop: any[] = [];
    for (const segment of segments) {
      if (loop.length > 0) {
        const previous = loop[loop.length - 1];
        const gap = Math.hypot(segment.x1 - previous.x2, segment.y1 - previous.y2);
        if (gap > 1e-3) {
          total += this.areaFromSegments(loop);
          loop = [];
        }
      }
      loop.push(segment);
    }
    if (loop.length > 0) total += this.areaFromSegments(loop);
    return total;
  }

  private subtractHoleArea(baseArea: number, obj: any): number {
    const holeArea = Array.isArray(obj.holes)
      ? obj.holes.reduce((total: number, hole: any) => {
          if (Array.isArray(hole?.segments) && hole.segments.length > 0) {
            return total + this.areaFromClosedSegments(hole.segments);
          }
          return total;
        }, 0)
      : 0;
    return Math.max(0, baseArea - holeArea);
  }

  private getHolePerimeter(obj: any, label: string): number {
    if (!Array.isArray(obj.holes)) return 0;
    return obj.holes.reduce((total: number, hole: any, index: number) => {
      if (!Array.isArray(hole?.segments) || hole.segments.length === 0) return total;
      return total + this.getLengthFromObject(
        { type: "path", closed: true, segments: hole.segments },
        `${label}.holes[${index}]`
      );
    }, 0);
  }

  private sampleSegmentsAsPolyline(segments: any[]): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    segments.forEach((segment, index) => {
      const sampled = this.sampleSegmentLikePoints(segment);
      if (index === 0) {
        points.push(...sampled);
      } else {
        points.push(...sampled.slice(1));
      }
    });
    return points;
  }

  private sampleSegmentLikePoints(segment: any): { x: number; y: number }[] {
    if (segment.type === "line") {
      return [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
    }

    if (segment.type === "arc") {
      const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
      let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
      if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
      if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;
      const points: { x: number; y: number }[] = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = startAngle + (endAngle - startAngle) * t;
        points.push({
          x: segment.cx + segment.radius * Math.cos(angle),
          y: segment.cy + segment.radius * Math.sin(angle),
        });
      }
      return points;
    }

    if (segment.type === "quadratic") {
      const points: { x: number; y: number }[] = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        points.push(
          this.pointOnQuadratic(
            { x: segment.x1, y: segment.y1 },
            { x: segment.cpx, y: segment.cpy },
            { x: segment.x2, y: segment.y2 },
            i / steps
          )
        );
      }
      return points;
    }

    const points: { x: number; y: number }[] = [];
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      points.push(
        this.pointOnCubic(
          { x: segment.x1, y: segment.y1 },
          { x: segment.cp1x, y: segment.cp1y },
          { x: segment.cp2x, y: segment.cp2y },
          { x: segment.x2, y: segment.y2 },
          i / steps
        )
      );
    }
    return points;
  }

  private sampleObjectBoundaryPoints(obj: any, label: string, steps = 64): { x: number; y: number }[] {
    if (obj.type === "point") {
      return [{ x: obj.x, y: obj.y }];
    }
    if (obj.type === "line") {
      return [{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }];
    }
    if (obj.type === "path" && Array.isArray(obj.segments) && obj.segments.length > 0) {
      return this.sampleSegmentsAsPolyline(obj.segments);
    }
    if (obj.type === "polygon" && Array.isArray(obj.segments) && obj.segments.length > 0) {
      return this.sampleSegmentsAsPolyline(obj.segments);
    }
    if ((obj.type === "path" || obj.type === "polygon") && Array.isArray(obj.points) && obj.points.length > 0) {
      return obj.points;
    }

    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      points.push(this.getPointAtObject(obj, i / steps, label));
    }
    return points;
  }

  private bboxFromPoints(points: { x: number; y: number }[]) {
    if (points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let i = 1; i < points.length; i++) {
      minX = Math.min(minX, points[i].x);
      maxX = Math.max(maxX, points[i].x);
      minY = Math.min(minY, points[i].y);
      maxY = Math.max(maxY, points[i].y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private approximateQuadraticLength(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 24
  ): number {
    let total = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const next = {
        x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
      };
      total += Math.hypot(next.x - prev.x, next.y - prev.y);
      prev = next;
    }
    return total;
  }

  private approximateCubicLength(
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 32
  ): number {
    let total = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const next = {
        x:
          mt * mt * mt * p0.x +
          3 * mt * mt * t * cp1.x +
          3 * mt * t * t * cp2.x +
          t * t * t * p1.x,
        y:
          mt * mt * mt * p0.y +
          3 * mt * mt * t * cp1.y +
          3 * mt * t * t * cp2.y +
          t * t * t * p1.y,
      };
      total += Math.hypot(next.x - prev.x, next.y - prev.y);
      prev = next;
    }
    return total;
  }

  private transformPointForObject(
    point: { x: number; y: number },
    objectId: string,
    direction: "world" | "local"
  ) {
    if (!this.context.objects) throw new Error(`Cannot resolve ${direction} transform without objects context`);
    const target = this.context.objects[objectId];
    if (!target) throw new Error(`Unknown object in ${direction === "world" ? "toWorld" : "toLocal"}: ${objectId}`);
    const pipeline = this.collectObjectTransformPipeline(objectId);
    if (direction === "world") {
      return applyTransformPipeline(point, pipeline as any);
    }
    return this.applyInverseTransformPipeline(point, pipeline as any[]);
  }

  private collectObjectTransformPipeline(objectId: string) {
    const pipeline: any[] = [];
    let currentId: string | undefined = objectId;
    while (currentId && this.context.objects) {
      const current = this.context.objects[currentId] as any;
      if (current?.transform?.length) {
        pipeline.push(...current.transform);
      }
      currentId = this.context.parentMap?.get(currentId);
    }
    return pipeline;
  }

  private applyInverseTransformPipeline(point: { x: number; y: number }, transform: any[]): { x: number; y: number } {
    let { x, y } = point;
    for (let i = transform.length - 1; i >= 0; i--) {
      const op = transform[i];
      if (op.type === "translate") {
        x -= op.x;
        y -= op.y;
      } else if (op.type === "rotate") {
        const rad = (-op.angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = x - op.origin.x;
        const dy = y - op.origin.y;
        x = op.origin.x + dx * cos - dy * sin;
        y = op.origin.y + dx * sin + dy * cos;
      } else if (op.type === "scale") {
        x = op.origin.x + (x - op.origin.x) / op.factor[0];
        y = op.origin.y + (y - op.origin.y) / op.factor[1];
      } else if (op.type === "mirror") {
        if (op.axis === "x" || op.axis === "both") {
          x = op.origin.x - (x - op.origin.x);
        }
        if (op.axis === "y" || op.axis === "both") {
          y = op.origin.y - (y - op.origin.y);
        }
      }
    }
    return { x, y };
  }
}

export function evaluateExpression(
  expression: string | number,
  context: EvalContext,
  options: EvaluatorOptions = {}
): any {
  const evaluator = new Evaluator(context, options);
  return evaluator.evaluate(expression);
}

export function evaluateExpressionTyped(
  expression: string | number,
  context: EvalContext,
  options: EvaluatorOptions = {}
): TypedValue {
  const evaluator = new Evaluator(context, options);
  return evaluator.evaluateTyped(expression);
}

export function validateExpressionSyntax(expression: string): void {
  const evaluator = new Evaluator(
    {
      scalars: {},
      targetUnit: "px",
      callFunction: (name: string, args: TypedValue[]) => {
        if (["count", "first", "last"].includes(name)) {
          return { type: "number", value: 1 };
        }
        return undefined;
      }
    },
    {
      allowUnknownIdentifiers: true,
      allowUnknownGeometryObjects: true,
    }
  );
  try {
    evaluator.evaluate(expression);
  } catch (error) {
    throw normalizeEvaluatorError(error, "validate");
  }
}
