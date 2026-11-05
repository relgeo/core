import { ResolvedPoint, PointObject } from "../../types";
import { normalizeUnit } from "../../units";
import { evaluateExpression } from "../../evaluator";
import { createEvalContext } from "../eval-context";
import { ResolveContext, ResolveError } from "../types";
import { resolveAnchorValue } from "../anchors";
import { wrapError, resolveCustomAnchors, applyObjectPlacementAndTransform } from "./utils";

export function resolvePoint(id: string, obj: PointObject, ctx: ResolveContext): ResolvedPoint {
    const evalCtx = createEvalContext(ctx);
    let x = 0;
    let y = 0;

    try {
        if (obj.at) {
            if (obj.at === "origin") {
                x = 0;
                y = 0;
            } else if (Array.isArray(obj.at)) {
                x = normalizeUnit(evaluateExpression(obj.at[0], evalCtx), ctx.targetUnit);
                y = normalizeUnit(evaluateExpression(obj.at[1], evalCtx), ctx.targetUnit);
            } else if (typeof obj.at === "string") {
                const val = evaluateExpression(obj.at, evalCtx);
                if (typeof val === "object" && val !== null && "x" in val && "y" in val) {
                    x = val.x;
                    y = val.y;
                } else if (typeof val === "number") {
                    x = val;
                    y = val;
                }
            }
        } else if (obj.on) {
            if (obj.on.point) {
                const ptVal = evaluateExpression(obj.on.point.at, evalCtx);
                if (typeof ptVal === "object" && ptVal !== null && "x" in ptVal && "y" in ptVal) {
                    x = ptVal.x;
                    y = ptVal.y;
                } else if (typeof ptVal === "number") {
                    x = ptVal;
                    y = ptVal;
                }
            } else if (obj.on.path) {
                const ptVal = evaluateExpression(`pointAt(${obj.on.path.path}, ${obj.on.path.t})`, evalCtx);
                if (ptVal && typeof ptVal === "object" && "x" in ptVal && "y" in ptVal) {
                    x = ptVal.x;
                    y = ptVal.y;
                }
            } else if (obj.on.frame) {
                const frameVal = evaluateExpression(`frameAt(${obj.on.frame.path}, ${obj.on.frame.t})`, evalCtx);
                if (frameVal && typeof frameVal === "object") {
                    let f = frameVal;
                    if (f.type === "object" && f.value) f = f.value;
                    if (f.type === "frame2d" && f.value) f = f.value;
                    if (f && f.point !== undefined) {
                        x = f.point.x;
                        y = f.point.y;
                    }
                }
            }
        }

        if (obj.from || obj.move) {
            let baseX = x, baseY = y;
            if (obj.from) {
                const p = resolveAnchorValue(obj.from, ctx);
                baseX = typeof p === "number" ? p : p.x;
                baseY = typeof p === "number" ? p : p.y;
                // If no move, default to from position
                x = baseX;
                y = baseY;
            }

            if (obj.move) {
                if (obj.move.distance !== undefined && obj.move.angle !== undefined) {
                    const dist = normalizeUnit(evaluateExpression(obj.move.distance, evalCtx), ctx.targetUnit);
                    const rad = evaluateExpression(obj.move.angle, evalCtx);
                    x = baseX + dist * Math.cos(rad);
                    y = baseY + dist * Math.sin(rad);
                } else {
                    if (obj.move.right !== undefined) x = baseX + normalizeUnit(evaluateExpression(obj.move.right, evalCtx), ctx.targetUnit);
                    if (obj.move.left !== undefined) x = baseX - normalizeUnit(evaluateExpression(obj.move.left, evalCtx), ctx.targetUnit);
                    if (obj.move.up !== undefined) y = baseY - normalizeUnit(evaluateExpression(obj.move.up, evalCtx), ctx.targetUnit);
                    if (obj.move.down !== undefined) y = baseY + normalizeUnit(evaluateExpression(obj.move.down, evalCtx), ctx.targetUnit);
                    if (obj.move.x !== undefined) x = baseX + normalizeUnit(evaluateExpression(obj.move.x, evalCtx), ctx.targetUnit);
                    if (obj.move.y !== undefined) y = baseY + normalizeUnit(evaluateExpression(obj.move.y, evalCtx), ctx.targetUnit);
                }
            }
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id);
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ResolveError(`Point "${id}" must resolve to finite coordinates`, "INVALID_VALUE", id, "at");
    }

    const bbox = { x, y, width: 0, height: 0 };
    const { resolvedTransform } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const resolved: ResolvedPoint = {
        id,
        type: "point",
        x,
        y,
        meta: { ...obj.meta },
    };

    if (obj.pointShape !== undefined) {
        resolved.meta!.pointShape = String(evaluateExpression(obj.pointShape, evalCtx));
    }
    if (obj.color !== undefined) {
        resolved.meta!.color = String(evaluateExpression(obj.color, evalCtx));
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}
