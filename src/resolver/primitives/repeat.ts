import { RepeatObject, ResolvedObject, type RelGeoErrorCode } from "../../types";
import { evaluateExpression } from "../../evaluator";
import { createEvalContext } from "../eval-context";
import { ResolveContext, ResolveError } from "../types";
import { resolveObject } from "../objects";
import { resolveAnchorValue } from "../anchors";
import { normalizeUnit } from "../../units";
import { applyObjectPlacementAndTransform } from "./utils";
import { getObjectBoundingBox } from "../geometry-utils";
import { stripErrorCodePrefix } from "../../errors";

function throwRepeatError(
    message: string,
    code: RelGeoErrorCode,
    id: string,
    path: string,
): never {
    throw new ResolveError(message, code, id, path);
}

function isClosedPathLike(obj: any): boolean {
    return obj?.type === "circle"
        || obj?.type === "ellipse"
        || obj?.type === "rect"
        || obj?.type === "polygon"
        || obj?.type === "boolean"
        || (obj?.type === "path" && obj.closed === true);
}

function isPositiveInteger(value: number): boolean {
    return !Number.isNaN(value) && value > 0 && Number.isInteger(value);
}

function hasExplicitRepeatPosition(item: any): boolean {
    return item?.place !== undefined
        || item?.on !== undefined
        || item?.at !== undefined
        || item?.center !== undefined
        || item?.from !== undefined
        || item?.to !== undefined
        || item?.through !== undefined
        || item?.points !== undefined
        || item?.segments !== undefined;
}

function stableRepeatChildId(parentId: string, coordinates: number[]): string {
    return `${parentId}[${coordinates.join(",")}]`;
}

function translateResolvedObject(obj: any, dx: number, dy: number) {
    if (!obj) return;
    if (obj.x !== undefined) obj.x += dx;
    if (obj.y !== undefined) obj.y += dy;
    if (obj.cx !== undefined) obj.cx += dx;
    if (obj.cy !== undefined) obj.cy += dy;
    if (obj.x1 !== undefined) obj.x1 += dx;
    if (obj.y1 !== undefined) obj.y1 += dy;
    if (obj.x2 !== undefined) obj.x2 += dx;
    if (obj.y2 !== undefined) obj.y2 += dy;
    if (obj.cpx !== undefined) obj.cpx += dx;
    if (obj.cpy !== undefined) obj.cpy += dy;
    if (obj.cp1x !== undefined) obj.cp1x += dx;
    if (obj.cp1y !== undefined) obj.cp1y += dy;
    if (obj.cp2x !== undefined) obj.cp2x += dx;
    if (obj.cp2y !== undefined) obj.cp2y += dy;
    
    if (Array.isArray(obj.points)) {
        for (const pt of obj.points) {
            pt.x += dx;
            pt.y += dy;
        }
    }
    
    if (Array.isArray(obj.segments)) {
        for (const seg of obj.segments) {
            if (seg.x1 !== undefined) seg.x1 += dx;
            if (seg.y1 !== undefined) seg.y1 += dy;
            if (seg.x2 !== undefined) seg.x2 += dx;
            if (seg.y2 !== undefined) seg.y2 += dy;
            if (seg.cx !== undefined) seg.cx += dx;
            if (seg.cy !== undefined) seg.cy += dy;
        }
    }
    
    if (obj.bbox) {
        obj.bbox.x += dx;
        obj.bbox.y += dy;
    }
}

export function resolveRepeat(
    id: string,
    obj: RepeatObject,
    ctx: ResolveContext
): ResolvedObject {
    const evalCtx = createEvalContext(ctx);
    const childrenIds: string[] = [];
    const originalScalars = ctx.scalars;

    if ((obj as any).along) {
        const along = (obj as any).along;
        const targetId = String(along.target);
        const targetObj = ctx.objects[targetId];
        if (!targetObj) {
            throwRepeatError(
                `repeat.along target not found: ${targetId}`,
                "INVALID_REPEAT_ALONG_TARGET",
                id,
                `objects.${id}.along.target`,
            );
        }

        let totalLength: number;
        try {
            totalLength = Number(evaluateExpression(`length(${targetId})`, evalCtx));
        } catch (error: any) {
            throwRepeatError(
                stripErrorCodePrefix(error instanceof Error ? error.message : String(error)),
                "REPEAT_ALONG_LENGTH_FAILED",
                id,
                `objects.${id}.along`,
            );
        }
        if (!Number.isFinite(totalLength) || totalLength <= 0) {
            throwRepeatError(
                `target "${targetId}" does not expose usable path length`,
                "REPEAT_ALONG_LENGTH_FAILED",
                id,
                `objects.${id}.along`,
            );
        }

        const startOffset = along.startOffset !== undefined
            ? Number(normalizeUnit(
                typeof along.startOffset === "string"
                    ? evaluateExpression(along.startOffset, evalCtx)
                    : along.startOffset,
                ctx.targetUnit
            ))
            : 0;
        const endOffset = along.endOffset !== undefined
            ? Number(normalizeUnit(
                typeof along.endOffset === "string"
                    ? evaluateExpression(along.endOffset, evalCtx)
                    : along.endOffset,
                ctx.targetUnit
            ))
            : 0;

        const usableLength = totalLength - startOffset - endOffset;
        if (
            !Number.isFinite(startOffset)
            || !Number.isFinite(endOffset)
            || startOffset < 0
            || endOffset < 0
            || usableLength < 0
        ) {
            throwRepeatError(
                `repeat.along offsets must be finite and non-negative, with a non-negative usable length for "${id}"`,
                "INVALID_REPEAT_ALONG_SPACING",
                id,
                `objects.${id}.along`,
            );
        }

        const spacing = along.spacing;
        const isClosed = isClosedPathLike(targetObj);
        let count = 0;
        let distanceStep = 0;

        if (spacing === "fixed-distance") {
            let distanceVal = along.distance;
            if (typeof distanceVal === "string") {
                distanceVal = evaluateExpression(distanceVal, evalCtx);
            }
            distanceStep = Number(normalizeUnit(distanceVal, ctx.targetUnit));
            if (!Number.isFinite(distanceStep) || distanceStep <= 0) {
                throwRepeatError(
                    `repeat.along distance must be a positive length, got ${along.distance}`,
                    "INVALID_FIXED_DISTANCE",
                    id,
                    `objects.${id}.along.distance`,
                );
            }
            count = Math.floor(usableLength / distanceStep) + 1;
        } else {
            let countVal = along.count;
            if (typeof countVal === "string") {
                countVal = evaluateExpression(countVal, evalCtx);
            }
            count = Number(countVal);
            if (!isPositiveInteger(count)) {
                throwRepeatError(
                    `repeat.along count must be a positive integer, got ${countVal}`,
                    "INVALID_REPEAT_COUNT",
                    id,
                    `objects.${id}.along.count`,
                );
            }
        }

        const hasExplicitPosition = hasExplicitRepeatPosition(obj.item);

        for (let i = 0; i < count; i++) {
            let distance = startOffset;
            let t = 0;

            if (spacing === "uniform-length") {
                if (count === 1) {
                    distance = startOffset;
                } else if (isClosed) {
                    distance = startOffset + (usableLength * i) / count;
                } else {
                    distance = startOffset + (usableLength * i) / (count - 1);
                }
                t = Number(evaluateExpression(`tAtLength(${targetId}, ${distance})`, evalCtx));
            } else if (spacing === "uniform-t") {
                // Closed paths must not duplicate their start point at t=1.
                // This mirrors the uniform-length policy while preserving
                // endpoint-inclusive traversal for open paths.
                t = count === 1 ? 0 : isClosed ? i / count : i / (count - 1);
                distance = startOffset + usableLength * t;
            } else if (spacing === "fixed-distance") {
                distance = startOffset + i * distanceStep;
                t = Number(evaluateExpression(`tAtLength(${targetId}, ${distance})`, evalCtx));
            } else {
                throwRepeatError(
                    `unsupported repeat.along spacing "${spacing}"`,
                    "INVALID_REPEAT_ALONG_SPACING",
                    id,
                    `objects.${id}.along.spacing`,
                );
            }

            const point = evaluateExpression(`pointAt(${targetId}, ${t})`, evalCtx);
            const tangent = evaluateExpression(`tangentAt(${targetId}, ${t})`, evalCtx);
            const normal = evaluateExpression(`normalAt(${targetId}, ${t})`, evalCtx);
            const frame = evaluateExpression(`frameAt(${targetId}, ${t})`, evalCtx);
            const angle = frame?.angle ?? 0;

            const itemContext = {
                x: point.x,
                y: point.y,
                t,
                point,
                position: point,
                tangent,
                normal,
                frame,
                angle,
                distance,
            };

            const childId = stableRepeatChildId(id, [i]);

            ctx.scalars = {
                ...originalScalars,
                index: i,
                count,
                row: 0,
                col: i,
                item: itemContext,
            };

            const resolvedChild = resolveObject(childId, obj.item, ctx);
            if (resolvedChild) {
                if (!hasExplicitPosition) {
                    translateResolvedObject(resolvedChild, point.x, point.y);
                }
                ctx.objects[childId] = resolvedChild;
                childrenIds.push(childId);
            }
        }
    } else if (obj.grid) {
        let rowsVal = obj.grid.rows;
        if (typeof rowsVal === "string") rowsVal = evaluateExpression(rowsVal, evalCtx);
        const rows = Number(rowsVal);
        if (!isPositiveInteger(rows)) {
            throwRepeatError(
                `grid rows must be a positive integer, got ${rowsVal}`,
                "INVALID_REPEAT_COUNT",
                id,
                `objects.${id}.grid.rows`,
            );
        }

        let colsVal = obj.grid.cols;
        if (typeof colsVal === "string") colsVal = evaluateExpression(colsVal, evalCtx);
        const cols = Number(colsVal);
        if (!isPositiveInteger(cols)) {
            throwRepeatError(
                `grid cols must be a positive integer, got ${colsVal}`,
                "INVALID_REPEAT_COUNT",
                id,
                `objects.${id}.grid.cols`,
            );
        }
        
        let pitchX: number | undefined;
        let pitchY: number | undefined;
        let gapX: number | undefined;
        let gapY: number | undefined;
        
        if (obj.grid.pitch !== undefined) {
            let pVal = obj.grid.pitch;
            if (typeof pVal === "string") pVal = evaluateExpression(pVal, evalCtx);
            else if (Array.isArray(pVal)) pVal = pVal.map(g => typeof g === "string" ? evaluateExpression(g, evalCtx) : g) as any;
            const normPitch = normalizeUnit(pVal as any, ctx.targetUnit);
            if (Array.isArray(normPitch)) {
                pitchX = Number(normPitch[0]);
                pitchY = Number(normPitch[1]);
            } else {
                pitchX = Number(normPitch);
                pitchY = Number(normPitch);
            }
        } else if (obj.grid.gap !== undefined) {
            let gVal = obj.grid.gap;
            if (typeof gVal === "string") gVal = evaluateExpression(gVal, evalCtx);
            else if (Array.isArray(gVal)) gVal = gVal.map(g => typeof g === "string" ? evaluateExpression(g, evalCtx) : g) as any;
            const normGap = normalizeUnit(gVal as any, ctx.targetUnit);
            if (Array.isArray(normGap)) {
                gapX = Number(normGap[0]);
                gapY = Number(normGap[1]);
            } else {
                gapX = Number(normGap);
                gapY = Number(normGap);
            }
        }

        if (pitchX !== undefined && pitchY !== undefined) {
            if (![pitchX, pitchY].every(value => Number.isFinite(value) && value > 0)) {
                throwRepeatError(
                    `grid pitch must contain finite positive lengths, got ${obj.grid.pitch}`,
                    "INVALID_GRID_SPACING",
                    id,
                    `objects.${id}.grid.pitch`,
                );
            }
        }
        if (gapX !== undefined && gapY !== undefined) {
            if (![gapX, gapY].every(value => Number.isFinite(value) && value >= 0)) {
                throwRepeatError(
                    `grid gap must contain finite non-negative lengths, got ${obj.grid.gap}`,
                    "INVALID_GRID_SPACING",
                    id,
                    `objects.${id}.grid.gap`,
                );
            }
        }

        const gridItems: { r: number, c: number, id: string }[] = [];
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const index = r * cols + c;
                const count = rows * cols;
                const childId = stableRepeatChildId(id, [r, c]);

                ctx.scalars = {
                    ...originalScalars,
                    index,
                    count,
                    row: r,
                    col: c,
                    rows,
                    cols
                };

                const resolvedChild = resolveObject(childId, obj.item, ctx);
                if (resolvedChild) {
                    ctx.objects[childId] = resolvedChild;
                    childrenIds.push(childId);
                    gridItems.push({ r, c, id: childId });
                }
            }
        }

        if (pitchX !== undefined && pitchY !== undefined) {
            for (const item of gridItems) {
                translateResolvedObject(ctx.objects[item.id], item.c * pitchX, item.r * pitchY);
            }
        } else if (gapX !== undefined && gapY !== undefined) {
            const colWidths: number[] = new Array(cols).fill(0);
            const rowHeights: number[] = new Array(rows).fill(0);
            
            for (const item of gridItems) {
                const bbox = getObjectBoundingBox(item.id, ctx.objects);
                if (bbox && Number.isFinite(bbox.width) && Number.isFinite(bbox.height)) {
                    colWidths[item.c] = Math.max(colWidths[item.c], bbox.width);
                    rowHeights[item.r] = Math.max(rowHeights[item.r], bbox.height);
                }
            }
            
            for (const item of gridItems) {
                let x = 0;
                for (let i = 0; i < item.c; i++) x += colWidths[i] + gapX;
                let y = 0;
                for (let i = 0; i < item.r; i++) y += rowHeights[i] + gapY;
                
                translateResolvedObject(ctx.objects[item.id], x, y);
            }
        }
    } else if (obj.polar) {
        let countVal = obj.polar.count;
        if (typeof countVal === "string") countVal = evaluateExpression(countVal, evalCtx);
        const count = Number(countVal);
        if (!isPositiveInteger(count)) {
            throwRepeatError(
                `polar count must be a positive integer, got ${countVal}`,
                "INVALID_REPEAT_COUNT",
                id,
                `objects.${id}.polar.count`,
            );
        }

        let radVal = obj.polar.radius;
        if (typeof radVal === "string") radVal = evaluateExpression(radVal, evalCtx);
        const radius = Number(normalizeUnit(radVal, ctx.targetUnit));
        if (!Number.isFinite(radius) || radius <= 0) {
            throwRepeatError(
                `polar radius must be a positive finite length, got ${radVal}`,
                "INVALID_VALUE",
                id,
                `objects.${id}.polar.radius`,
            );
        }
        
        const centerPt = resolveAnchorValue(obj.polar.center, ctx);
        const cx = typeof centerPt === "number" ? centerPt : (centerPt?.x ?? 0);
        const cy = typeof centerPt === "number" ? centerPt : (centerPt?.y ?? 0);

        const hasExplicitPosition = hasExplicitRepeatPosition(obj.item);

        for (let i = 0; i < count; i++) {
            const angle = i * ((2 * Math.PI) / count);
            const pt = {
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle)
            };
            const itemContext = { x: pt.x, y: pt.y, position: pt, angle };

            const childId = stableRepeatChildId(id, [i]);

            ctx.scalars = {
                ...originalScalars,
                index: i,
                count,
                row: 0,
                col: i,
                item: itemContext
            };

            const resolvedChild = resolveObject(childId, obj.item, ctx);
            if (resolvedChild) {
                if (!hasExplicitPosition) {
                    translateResolvedObject(resolvedChild, pt.x, pt.y);
                }
                ctx.objects[childId] = resolvedChild;
                childrenIds.push(childId);
            }
        }
    } else if (obj.each) {
        let pointsList: { x: number; y: number }[] = [];

        if (typeof obj.each === "string" && ctx.objects[obj.each]) {
            const target = ctx.objects[obj.each];
            if (target.type === "collection" && Array.isArray((target as any).points)) {
                pointsList = (target as any).points;
            } else if (target.type === "point") {
                pointsList = [{ x: (target as any).x, y: (target as any).y }];
            }
        } else {
            let evaluatedEach = obj.each;
            if (typeof evaluatedEach === "string") evaluatedEach = evaluateExpression(evaluatedEach, evalCtx);
            const normEach = normalizeUnit(evaluatedEach, ctx.targetUnit);
            if (Array.isArray(normEach)) {
                pointsList = normEach.map((item: any) => {
                    if (Array.isArray(item)) return { x: Number(item[0]), y: Number(item[1]) };
                    if (item && typeof item === "object" && "x" in item && "y" in item) return { x: Number(item.x), y: Number(item.y) };
                    return { x: 0, y: 0 };
                });
            }
        }

        const count = pointsList.length;
        const hasExplicitPosition = hasExplicitRepeatPosition(obj.item);
        
        for (let i = 0; i < count; i++) {
            const pt = pointsList[i];
            const itemContext = { x: pt.x, y: pt.y, position: pt, angle: 0 };
            const childId = stableRepeatChildId(id, [i]);

            ctx.scalars = {
                ...originalScalars,
                index: i,
                count,
                row: 0,
                col: i,
                item: itemContext
            };

            const resolvedChild = resolveObject(childId, obj.item, ctx);
            if (resolvedChild) {
                if (!hasExplicitPosition) {
                    translateResolvedObject(resolvedChild, pt.x, pt.y);
                }
                ctx.objects[childId] = resolvedChild;
                childrenIds.push(childId);
            }
        }
    } else {
        let countVal = obj.count || 1;
        if (typeof countVal === "string") countVal = evaluateExpression(countVal, evalCtx);
        const count = Number(countVal);
        if (!isPositiveInteger(count)) {
            throwRepeatError(
                `repeat count must be a positive integer, got ${countVal}`,
                "INVALID_REPEAT_COUNT",
                id,
                `objects.${id}.count`,
            );
        }

        for (let i = 0; i < count; i++) {
            const pt = { x: 0, y: 0 };
            const itemContext = { x: pt.x, y: pt.y, position: pt, angle: 0 };
            const childId = stableRepeatChildId(id, [i]);

            ctx.scalars = {
                ...originalScalars,
                index: i,
                count,
                row: 0,
                col: i,
                item: itemContext
            };

            const resolvedChild = resolveObject(childId, obj.item, ctx);
            if (resolvedChild) {
                ctx.objects[childId] = resolvedChild;
                childrenIds.push(childId);
            }
        }
    }

    ctx.scalars = originalScalars;

    const result: any = {
        id,
        type: "collection",
        children: childrenIds,
        meta: obj.meta
    };

    if (obj.place || obj.transform) {
        ctx.objects[id] = result;
        const bbox = getObjectBoundingBox(id, ctx.objects, undefined, ctx.parentMap);
        const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj as any, bbox, ctx);
        
        if (dx !== 0 || dy !== 0) {
            for (const childId of childrenIds) {
                const childObj = ctx.objects[childId];
                translateResolvedObject(childObj, dx, dy);
            }
        }
        if (resolvedTransform && resolvedTransform.length > 0) {
            result.transform = resolvedTransform;
        }
    }

    return result;
}
