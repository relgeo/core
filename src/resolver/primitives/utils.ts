import type { BoundingBox, ResolvedTransform, PlaceSpec } from "../../types";
import { normalizeUnit } from "../../units";
import { evaluateExpression } from "../../evaluator";
import { ResolveContext, ResolveError } from "../types";
import { hasStructuredDiagnostic, normalizeErrorCode, stripErrorCodePrefix } from "../../errors";
import { createEvalContext } from "../eval-context";
import { resolveAnchorValue } from "../anchors";
import { calculateBoundingBox, getObjectBoundingBox } from "../geometry-utils";

export function wrapError(e: any, id: string, path?: string): never {
    if (e instanceof ResolveError) throw e;
    if (hasStructuredDiagnostic(e)) throw e;
    const rawMessage = e instanceof Error ? e.message : String(e);
    const code = normalizeErrorCode(e?.code, rawMessage, "RESOLVE_ERROR");
    throw new ResolveError(stripErrorCodePrefix(rawMessage), code, id, path);
}

function resolveInsidePlacement(place: PlaceSpec, ctx: ResolveContext, evalCtx: ReturnType<typeof createEvalContext>) {
    const targetId = place.inside;
    if (targetId === undefined || !ctx.objects[targetId]) {
        throw new ResolveError(`Invalid expression syntax: Unknown identifier: ${targetId}`, "INVALID_EXPRESSION");
    }
    const target = ctx.objects[targetId];
    if (target.type !== "rect") {
        throw new ResolveError(`place.inside target "${targetId}" must be a rect`, "INVALID_VALUE");
    }

    const bbox = getObjectBoundingBox(targetId, ctx.objects);
    let margin = 0;
    if (place.margin !== undefined) {
        margin = Number(normalizeUnit(evaluateExpression(place.margin, evalCtx), ctx.targetUnit));
        if (!Number.isFinite(margin) || margin < 0) {
            throw new ResolveError(`place.inside margin must be a non-negative finite length`, "INVALID_VALUE");
        }
    }
    return { bbox, margin };
}

function assertFinitePlacement(value: number | undefined, path: string): void {
    if (value !== undefined && !Number.isFinite(value)) {
        throw new ResolveError(`Placement value at ${path} must resolve to a finite number`, "INVALID_VALUE", undefined, path);
    }
}

function assertFiniteResolvedTransform(transform: ResolvedTransform): void {
    for (const [index, op] of transform.entries()) {
        if (op.type === "translate") {
            if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) {
                throw new ResolveError(`Transform ${index} contains non-finite translation values`, "INVALID_VALUE", undefined, `transform[${index}]`);
            }
        } else if (op.type === "rotate") {
            if (!Number.isFinite(op.angle) || !Number.isFinite(op.origin.x) || !Number.isFinite(op.origin.y)) {
                throw new ResolveError(`Transform ${index} contains non-finite rotation values`, "INVALID_VALUE", undefined, `transform[${index}]`);
            }
        } else if (op.type === "scale") {
            if (!Number.isFinite(op.factor[0]) || !Number.isFinite(op.factor[1]) || !Number.isFinite(op.origin.x) || !Number.isFinite(op.origin.y)) {
                throw new ResolveError(`Transform ${index} contains non-finite scale values`, "INVALID_VALUE", undefined, `transform[${index}]`);
            }
        } else if (op.type === "mirror") {
            if (!["x", "y", "both"].includes(op.axis) || !Number.isFinite(op.origin.x) || !Number.isFinite(op.origin.y)) {
                throw new ResolveError(`Transform ${index} contains an invalid mirror contract`, "INVALID_VALUE", undefined, `transform[${index}]`);
            }
        }
    }
}

export function resolvePlaceX(place: PlaceSpec, width: number, ctx: ResolveContext): number {
    const evalCtx = createEvalContext(ctx);
    let val: number | undefined;

    if (place.left !== undefined) {
        val = normalizeUnit(evaluateExpression(place.left, evalCtx), ctx.targetUnit);
    } else if (place.right !== undefined) {
        val = normalizeUnit(evaluateExpression(place.right, evalCtx), ctx.targetUnit) - width;
    } else if (place.centerX !== undefined) {
        val = normalizeUnit(evaluateExpression(place.centerX, evalCtx), ctx.targetUnit) - width / 2;
    } else if (place.center !== undefined) {
        const p = resolveAnchorValue(place.center, ctx);
        val = (typeof p === "number" ? p : p.x) - width / 2;
    } else if (place.inside !== undefined) {
        const { bbox, margin } = resolveInsidePlacement(place, ctx, evalCtx);
        val = place.margin !== undefined
            ? bbox.x + margin
            : bbox.x + (bbox.width - width) / 2;
    } else if (place.topLeft !== undefined) {
        const p = resolveAnchorValue(place.topLeft, ctx);
        val = typeof p === "number" ? p : p.x;
    } else if (place.topRight !== undefined) {
        const p = resolveAnchorValue(place.topRight, ctx);
        val = (typeof p === "number" ? p : p.x) - width;
    } else if (place.bottomLeft !== undefined) {
        const p = resolveAnchorValue(place.bottomLeft, ctx);
        val = typeof p === "number" ? p : p.x;
    } else if (place.bottomRight !== undefined) {
        const p = resolveAnchorValue(place.bottomRight, ctx);
        val = (typeof p === "number" ? p : p.x) - width;
    } else if (place.topCenter !== undefined) {
        const p = resolveAnchorValue(place.topCenter, ctx);
        val = (typeof p === "number" ? p : p.x) - width / 2;
    } else if (place.bottomCenter !== undefined) {
        const p = resolveAnchorValue(place.bottomCenter, ctx);
        val = (typeof p === "number" ? p : p.x) - width / 2;
    } else if (place.centerLeft !== undefined) {
        const p = resolveAnchorValue(place.centerLeft, ctx);
        val = typeof p === "number" ? p : p.x;
    } else if (place.centerRight !== undefined) {
        const p = resolveAnchorValue(place.centerRight, ctx);
        val = (typeof p === "number" ? p : p.x) - width;
    } else if (place.align !== undefined) {
        const p = resolveAnchorValue(place.align.target, ctx);
        const targetX = typeof p === "number" ? p : p.x;
        const offset = place.align.offset !== undefined ? 
            normalizeUnit(evaluateExpression(place.align.offset, evalCtx), ctx.targetUnit) : 0;
        
        const mode = place.align.to || "center";
        if (mode === "left") val = targetX + offset;
        else if (mode === "right") val = targetX - width + offset;
        else val = targetX - width / 2 + offset;
    }

    assertFinitePlacement(val, "place.x");
    return val !== undefined ? val : 0;
}

function getLocalAnchorBBox(resolved: any, groupBBox: BoundingBox | undefined, ctx: ResolveContext): BoundingBox {
    if (resolved.type === "group" && groupBBox) {
        return groupBBox;
    }
    const localObj = { ...resolved, transform: undefined };
    return getObjectBoundingBox(resolved.id, { ...ctx.objects, [resolved.id]: localObj });
}

export function resolvePlaceY(place: PlaceSpec, height: number, ctx: ResolveContext): number {
    const evalCtx = createEvalContext(ctx);
    let val: number | undefined;

    if (place.top !== undefined) {
        val = normalizeUnit(evaluateExpression(place.top, evalCtx), ctx.targetUnit);
    } else if (place.bottom !== undefined) {
        val = normalizeUnit(evaluateExpression(place.bottom, evalCtx), ctx.targetUnit) - height;
    } else if (place.centerY !== undefined) {
        val = normalizeUnit(evaluateExpression(place.centerY, evalCtx), ctx.targetUnit) - height / 2;
    } else if (place.center !== undefined) {
        const p = resolveAnchorValue(place.center, ctx);
        val = (typeof p === "number" ? p : p.y) - height / 2;
    } else if (place.inside !== undefined) {
        const { bbox, margin } = resolveInsidePlacement(place, ctx, evalCtx);
        val = place.margin !== undefined
            ? bbox.y + margin
            : bbox.y + (bbox.height - height) / 2;
    } else if (place.topLeft !== undefined) {
        const p = resolveAnchorValue(place.topLeft, ctx);
        val = typeof p === "number" ? p : p.y;
    } else if (place.topRight !== undefined) {
        const p = resolveAnchorValue(place.topRight, ctx);
        val = typeof p === "number" ? p : p.y;
    } else if (place.bottomLeft !== undefined) {
        const p = resolveAnchorValue(place.bottomLeft, ctx);
        val = (typeof p === "number" ? p : p.y) - height;
    } else if (place.bottomRight !== undefined) {
        const p = resolveAnchorValue(place.bottomRight, ctx);
        val = (typeof p === "number" ? p : p.y) - height;
    } else if (place.topCenter !== undefined) {
        const p = resolveAnchorValue(place.topCenter, ctx);
        val = typeof p === "number" ? p : p.y;
    } else if (place.bottomCenter !== undefined) {
        const p = resolveAnchorValue(place.bottomCenter, ctx);
        val = (typeof p === "number" ? p : p.y) - height;
    } else if (place.centerLeft !== undefined) {
        const p = resolveAnchorValue(place.centerLeft, ctx);
        val = (typeof p === "number" ? p : p.y) - height / 2;
    } else if (place.centerRight !== undefined) {
        const p = resolveAnchorValue(place.centerRight, ctx);
        val = (typeof p === "number" ? p : p.y) - height / 2;
    } else if (place.align !== undefined) {
        const p = resolveAnchorValue(place.align.target, ctx);
        const targetY = typeof p === "number" ? p : p.y;
        const offset = place.align.offset !== undefined ? 
            normalizeUnit(evaluateExpression(place.align.offset, evalCtx), ctx.targetUnit) : 0;
        
        const mode = place.align.to || "center";
        if (mode === "top") val = targetY + offset;
        else if (mode === "bottom") val = targetY - height + offset;
        else val = targetY - height / 2 + offset;
    }

    assertFinitePlacement(val, "place.y");
    return val !== undefined ? val : 0;
}

export function resolveCustomAnchors(
    obj: any,
    resolved: any,
    ctx: ResolveContext,
    groupBBox?: BoundingBox
): Record<string, { x: number; y: number }> | undefined {
    if (!obj.anchors) return undefined;

    const evalCtx = createEvalContext(ctx);
    const result: Record<string, { x: number; y: number }> = {};
    const bbox = getLocalAnchorBBox(resolved, groupBBox, ctx);
    const baseX = bbox.x;
    const baseY = bbox.y;
    const width = bbox.width;
    const height = bbox.height;

    for (const [name, pos] of Object.entries(obj.anchors)) {
        if (Array.isArray(pos)) {
            let px = 0;
            let py = 0;

            if (typeof pos[0] === "string" && pos[0].endsWith("%")) {
                const relativeX = Number(pos[0].slice(0, -1));
                if (!Number.isFinite(relativeX)) {
                    throw new ResolveError(`Anchor "${name}" x percentage must be finite`, "INVALID_VALUE", resolved.id, `anchors.${name}[0]`);
                }
                px = baseX + (relativeX / 100) * width;
            } else {
                try {
                  px = baseX + normalizeUnit(evaluateExpression(pos[0], evalCtx), ctx.targetUnit);
                } catch (e) {
                  if (ctx.mode === "editor") px = baseX;
                  else wrapError(e, resolved.id, `anchors.${name}[0]`);
                }
            }

            if (typeof pos[1] === "string" && pos[1].endsWith("%")) {
                const relativeY = Number(pos[1].slice(0, -1));
                if (!Number.isFinite(relativeY)) {
                    throw new ResolveError(`Anchor "${name}" y percentage must be finite`, "INVALID_VALUE", resolved.id, `anchors.${name}[1]`);
                }
                py = baseY + (relativeY / 100) * height;
            } else {
                try {
                  py = baseY + normalizeUnit(evaluateExpression(pos[1], evalCtx), ctx.targetUnit);
                } catch (e) {
                  if (ctx.mode === "editor") py = baseY;
                  else wrapError(e, resolved.id, `anchors.${name}[1]`);
                }
            }
            if (!Number.isFinite(px) || !Number.isFinite(py)) {
                throw new ResolveError(`Anchor "${name}" must resolve to finite coordinates`, "INVALID_VALUE", resolved.id, `anchors.${name}`);
            }
            result[name] = { x: px, y: py };
        }
    }

    return result;
}

export function applyObjectPlacementAndTransform(
    obj: any,
    bbox: BoundingBox,
    ctx: ResolveContext,
    anchors?: Record<string, any>
): { resolvedTransform: ResolvedTransform | undefined, dx: number, dy: number, bbox: BoundingBox } {
    const evalCtx = createEvalContext(ctx);
    let pipeline: any[] = [];

    if (Array.isArray(obj.transform)) {
        pipeline = obj.transform;
    } else if (obj.transform) {
        const origin = (obj.transform as any).origin;
        for (const [key, val] of Object.entries(obj.transform)) {
            if (key === 'origin') continue;
            pipeline.push({ [key]: val, origin });
        }
    }

    const defaultOrigin = {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2
    };

    const resolvedPipeline: ResolvedTransform = [];
    let dx = 0;
    let dy = 0;

    try {
        for (const op of pipeline) {
            const keys = Object.keys(op).filter(k => k !== 'origin');
            const type = keys[0];
            const val = op[type];
            if (!type || !["translate", "rotate", "scale", "mirror"].includes(type)) {
                throw new ResolveError(`Unsupported transform operation "${String(type)}"`, "INVALID_VALUE", obj.id, "transform");
            }
            const localOriginRef = op.origin;
            let resolvedOrigin = defaultOrigin;

            if (localOriginRef) {
                if (typeof localOriginRef === "string" && anchors && anchors[localOriginRef]) {
                    resolvedOrigin = anchors[localOriginRef];
                } else {
                    const p = resolveAnchorValue(localOriginRef, ctx);
                    resolvedOrigin = typeof p === "number" ? { x: p, y: p } : p;
                }
            }

            if (type === 'translate') {
                resolvedPipeline.push({
                    type: 'translate',
                    x: normalizeUnit(evaluateExpression(val[0], evalCtx), ctx.targetUnit),
                    y: normalizeUnit(evaluateExpression(val[1], evalCtx), ctx.targetUnit),
                });
            } else if (type === 'rotate') {
                let angleExpr = val;
                let origin = resolvedOrigin;
                if (typeof val === 'object' && val !== null) {
                    angleExpr = val.angle;
                    if (val.origin) {
                        if (typeof val.origin === "string" && anchors && anchors[val.origin]) {
                            origin = anchors[val.origin];
                        } else {
                            const p = resolveAnchorValue(val.origin, ctx);
                            origin = typeof p === "number" ? { x: p, y: p } : p;
                        }
                    }
                }
                resolvedPipeline.push({
                    type: 'rotate',
                    angle: evaluateExpression(angleExpr, evalCtx) * (180 / Math.PI),
                    origin
                });
            } else if (type === 'scale') {
                let factorExpr = val;
                let origin = resolvedOrigin;
                if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                    factorExpr = val.factor;
                    if (val.origin) {
                        if (typeof val.origin === "string" && anchors && anchors[val.origin]) {
                            origin = anchors[val.origin];
                        } else {
                            const p = resolveAnchorValue(val.origin, ctx);
                            origin = typeof p === "number" ? { x: p, y: p } : p;
                        }
                    }
                }
                const factor: [number, number] = Array.isArray(factorExpr)
                    ? [evaluateExpression(factorExpr[0], evalCtx), evaluateExpression(factorExpr[1], evalCtx)]
                    : [evaluateExpression(factorExpr, evalCtx), evaluateExpression(factorExpr, evalCtx)];

                resolvedPipeline.push({
                    type: 'scale',
                    factor,
                    origin
                });
            } else if (type === 'mirror') {
                let axis = val;
                let origin = resolvedOrigin;
                if (typeof val === 'object' && val !== null) {
                    axis = val.axis;
                    if (val.origin) {
                        if (typeof val.origin === "string" && anchors && anchors[val.origin]) {
                            origin = anchors[val.origin];
                        } else {
                            const p = resolveAnchorValue(val.origin, ctx);
                            origin = typeof p === "number" ? { x: p, y: p } : p;
                        }
                    }
                }
                resolvedPipeline.push({
                    type: 'mirror',
                    axis: axis as any,
                    origin
                });
            }
        }

        assertFiniteResolvedTransform(resolvedPipeline);

        let orientedRotation: any = null;
        if (obj.on) {
            let targetX = bbox.x + bbox.width / 2;
            let targetY = bbox.y + bbox.height / 2;
            let anchorVal = "center";
            let onResolved = false;

            if (obj.on.point) {
                const ptVal = evaluateExpression(obj.on.point.at, evalCtx);
                if (ptVal && typeof ptVal === "object") {
                    let p = ptVal;
                    if (p.type === "object" && p.value) p = p.value;
                    if (p.type === "point" && p.value) p = p.value;
                    if (p && p.x !== undefined && p.y !== undefined) {
                        targetX = Number(p.x);
                        targetY = Number(p.y);
                        onResolved = true;
                    } else if (Array.isArray(p) && p.length === 2) {
                        targetX = normalizeUnit(evaluateExpression(p[0], evalCtx), ctx.targetUnit);
                        targetY = normalizeUnit(evaluateExpression(p[1], evalCtx), ctx.targetUnit);
                        onResolved = true;
                    }
                }
                if (obj.on.point.anchor) {
                    try { anchorVal = String(evaluateExpression(obj.on.point.anchor, evalCtx)); }
                    catch (e: any) { anchorVal = String(obj.on.point.anchor); }
                }
            } else if (obj.on.path) {
                const ptVal = evaluateExpression(`pointAt(${obj.on.path.path}, ${obj.on.path.t})`, evalCtx);
                if (ptVal && typeof ptVal === "object" && "x" in ptVal && "y" in ptVal) {
                    targetX = Number(ptVal.x);
                    targetY = Number(ptVal.y);
                    onResolved = true;
                }
                if (obj.on.path.anchor) {
                    try { anchorVal = String(evaluateExpression(obj.on.path.anchor, evalCtx)); }
                    catch (e: any) { anchorVal = String(obj.on.path.anchor); }
                }
            } else if (obj.on.frame) {
                const frameVal = evaluateExpression(`frameAt(${obj.on.frame.path}, ${obj.on.frame.t})`, evalCtx);
                if (frameVal && typeof frameVal === "object") {
                    let f = frameVal;
                    if (f.type === "object" && f.value) f = f.value;
                    if (f.type === "frame2d" && f.value) f = f.value;
                    if (f && f.point !== undefined) {
                        targetX = Number(f.point.x);
                        targetY = Number(f.point.y);
                        onResolved = true;
                        
                        const angleVal = typeof f.angle === "number" ? f.angle : 0;
                        orientedRotation = {
                            type: 'rotate' as const,
                            angle: angleVal * (180 / Math.PI), // convert to degrees
                            origin: { x: targetX, y: targetY }
                        };
                    }
                }
                if (obj.on.frame.anchor) {
                    try { anchorVal = String(evaluateExpression(obj.on.frame.anchor, evalCtx)); }
                    catch (e: any) { anchorVal = String(obj.on.frame.anchor); }
                }
            }

            if (onResolved) {
                let baseX = bbox.x + bbox.width / 2;
                let baseY = bbox.y + bbox.height / 2;
                
                if (anchorVal !== "center") {
                    if (anchors && anchors[anchorVal]) { 
                        baseX = anchors[anchorVal].x; 
                        baseY = anchors[anchorVal].y; 
                    }
                    else if (anchorVal === "topLeft") { baseX = bbox.x; baseY = bbox.y; }
                    else if (anchorVal === "topRight") { baseX = bbox.x + bbox.width; baseY = bbox.y; }
                    else if (anchorVal === "bottomLeft") { baseX = bbox.x; baseY = bbox.y + bbox.height; }
                    else if (anchorVal === "bottomRight") { baseX = bbox.x + bbox.width; baseY = bbox.y + bbox.height; }
                    else if (anchorVal === "topCenter" || anchorVal === "top") { baseX = bbox.x + bbox.width / 2; baseY = bbox.y; }
                    else if (anchorVal === "bottomCenter" || anchorVal === "bottom") { baseX = bbox.x + bbox.width / 2; baseY = bbox.y + bbox.height; }
                    else if (anchorVal === "centerLeft" || anchorVal === "left") { baseX = bbox.x; baseY = bbox.y + bbox.height / 2; }
                    else if (anchorVal === "centerRight" || anchorVal === "right") { baseX = bbox.x + bbox.width; baseY = bbox.y + bbox.height / 2; }
                }
                
                dx = targetX - baseX;
                dy = targetY - baseY;
            }
        } else if (obj.place) {
            let customAnchor = anchors ? Object.keys(obj.place).find(k => anchors[k] !== undefined) : undefined;
            if (customAnchor && anchors) {
                const targetRef = obj.place[customAnchor];
                const p = resolveAnchorValue(targetRef, ctx);
                const targetX = typeof p === "number" ? p : p.x;
                const targetY = typeof p === "number" ? p : p.y;
                dx = targetX - anchors[customAnchor].x;
                dy = targetY - anchors[customAnchor].y;
            } else {
                const targetX = resolvePlaceX(obj.place, bbox.width, ctx);
                const targetY = resolvePlaceY(obj.place, bbox.height, ctx);
                dx = targetX - bbox.x;
                dy = targetY - bbox.y;
            }
        }

        if (orientedRotation) {
            resolvedPipeline.unshift(orientedRotation);
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, obj.id || "");
    }

    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new ResolveError("Placement offsets must resolve to finite coordinates", "INVALID_VALUE", obj.id, "place");
    }

    return {
        resolvedTransform: resolvedPipeline.length > 0 ? resolvedPipeline : undefined,
        dx,
        dy,
        bbox: { ...bbox, x: bbox.x + dx, y: bbox.y + dy }
    };
}
