import {
    ResolvedRect,
    ResolvedLine,
    ResolvedCircle,
    ResolvedEllipse,
    ResolvedArc,
    ResolvedCubic,
    ResolvedQuadratic,
    ResolvedText,
    ResolvedPath,
    ResolvedPolygon,
    ResolvedBoolean,
    BooleanObject,
    PathResolvedSegment,
    RectObject,
    LineObject,
    CircleObject,
    EllipseObject,
    ArcObject,
    CubicObject,
    QuadraticObject,
    TextObject,
    PathObject,
    PolygonObject,
    AnchorRef,
    PathSegment,
    ResolvedObject
} from "../../types";
import {
    ClipperBooleanEngine,
    normalizeClosedShape,
    polyToSegments,
    PolyWithHoles
} from "@relgeo/geometry";
import { normalizeUnit } from "../../units";
import { evaluateExpression } from "../../evaluator";
import { createEvalContext } from "../eval-context";
import { ResolveContext, ResolveError } from "../types";
import { resolveAnchorValue } from "../anchors";
import { applyTransformPipeline } from "../transform-utils";
import { wrapError, resolveCustomAnchors, applyObjectPlacementAndTransform } from "./utils";
import { resolveClone } from "./clone";
import {
    applyCornerModifiers,
    offsetPolyline,
    validateNoSelfIntersection,
    type PathSegment as ModifierPathSegment,
    type CornerModifiers,
    type Point2D,
} from "../path-modifiers";

function resolvePointRef(ref: AnchorRef, ctx: ResolveContext) {
    const p = resolveAnchorValue(ref, ctx);
    return typeof p === "number" ? { x: p, y: p } : p;
}

function normalizeAngle(angle: number): number {
    const fullTurn = Math.PI * 2;
    let value = angle % fullTurn;
    if (value < 0) value += fullTurn;
    return value;
}

function isAngleOnSweep(start: number, end: number, target: number, sweep: 0 | 1 = 1): boolean {
    const s = normalizeAngle(start);
    const e = normalizeAngle(end);
    const t = normalizeAngle(target);

    if (sweep === 1) {
        if (s <= e) return t >= s && t <= e;
        return t >= s || t <= e;
    }

    if (e <= s) return t <= s && t >= e;
    return t <= s || t >= e;
}

function isAngleBetween(start: number, end: number, target: number): boolean {
    const s = normalizeAngle(start);
    const e = normalizeAngle(end);
    const t = normalizeAngle(target);
    if (s <= e) return t >= s && t <= e;
    return t >= s || t <= e;
}

function getCircumcenter(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) {
        throw new ResolveError(
            "Arc through three collinear points is degenerate",
            "DEGENERATE_ARC"
        );
    }

    const ux =
        ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
            (b.x * b.x + b.y * b.y) * (c.y - a.y) +
            (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
        d;
    const uy =
        ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
            (b.x * b.x + b.y * b.y) * (a.x - c.x) +
            (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
        d;

    return { x: ux, y: uy };
}

function getPathBBox(points: { x: number; y: number }[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    points.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });

    if (minX === Infinity) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

function getPathBBoxFromSegments(segments: NonNullable<ResolvedPath["segments"]>) {
    const points: { x: number; y: number }[] = [];

    segments.forEach((segment) => {
        if (segment.type === "line") {
            points.push({ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
            return;
        }

        if (segment.type === "arc") {
            const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
            let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
            if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
            if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;

            points.push({ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
            if (segment.xt !== undefined && segment.yt !== undefined) {
                points.push({ x: segment.xt, y: segment.yt });
            }

            [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((angle) => {
                if (isAngleOnSweep(startAngle, endAngle, angle, segment.sweep ?? 1)) {
                    points.push({
                        x: segment.cx + segment.radius * Math.cos(angle),
                        y: segment.cy + segment.radius * Math.sin(angle),
                    });
                }
            });
            return;
        }

        if (segment.type === "quadratic") {
            points.push(
                { x: segment.x1, y: segment.y1 },
                { x: segment.cpx, y: segment.cpy },
                { x: segment.x2, y: segment.y2 }
            );
            return;
        }

        points.push(
            { x: segment.x1, y: segment.y1 },
            { x: segment.cp1x, y: segment.cp1y },
            { x: segment.cp2x, y: segment.cp2y },
            { x: segment.x2, y: segment.y2 }
        );
    });

    return getPathBBox(points);
}

function pointsCoincide(a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 1e-6) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function stripDuplicateClosingPoint(points: Point2D[]) {
    if (points.length > 1 && pointsCoincide(points[0], points[points.length - 1])) {
        return points.slice(0, -1);
    }
    return points;
}

function getPathSourcePointsAndClosed(source: any, pathId: string): { points: Point2D[]; closed: boolean } {
    if (source?.type === "polygon") {
        if (Array.isArray(source.segments) && source.segments.length > 0) {
            return { points: flattenModifierSegments(source.segments as ModifierPathSegment[], true), closed: true };
        }
        return { points: source.points.map((p: Point2D) => ({ ...p })), closed: true };
    }

    if (source?.type === "path") {
        if (Array.isArray(source.segments) && source.segments.length > 0) {
            const points = flattenModifierSegments(source.segments as ModifierPathSegment[], source.closed === true);
            return { points, closed: source.closed === true };
        }

        if (Array.isArray(source.points) && source.points.length > 1) {
            return { points: source.points.map((p: Point2D) => ({ ...p })), closed: source.closed === true };
        }
    }

    throw new ResolveError(
        `Path "${pathId}" offset source must be a path or polygon`,
        "TYPE_MISMATCH",
        pathId,
        "offset.from"
    );
}

function buildLineSegmentsFromPoints(points: Point2D[], closed: boolean): ModifierPathSegment[] {
    const stripped = closed ? stripDuplicateClosingPoint(points) : points;
    const segments: ModifierPathSegment[] = [];
    const segCount = closed ? stripped.length : stripped.length - 1;
    for (let i = 0; i < segCount; i++) {
        const a = stripped[i];
        const b = stripped[(i + 1) % stripped.length];
        segments.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return segments;
}

function pointsFromSegments(segments: ModifierPathSegment[], closed: boolean): Point2D[] {
    if (segments.length === 0) return [];
    const points: Point2D[] = [{ x: segments[0].x1, y: segments[0].y1 }];
    segments.forEach((segment) => {
        points.push({ x: segment.x2, y: segment.y2 });
        if (segment.type === "arc" && segment.xt !== undefined && segment.yt !== undefined) {
            points.push({ x: segment.xt, y: segment.yt });
        } else if (segment.type === "quadratic") {
            points.push({ x: segment.cpx, y: segment.cpy });
        } else if (segment.type === "cubic") {
            points.push({ x: segment.cp1x, y: segment.cp1y }, { x: segment.cp2x, y: segment.cp2y });
        }
    });
    return closed ? stripDuplicateClosingPoint(points) : points;
}

function sampleModifierSegmentPoints(segment: ModifierPathSegment, steps = 32): Point2D[] {
    if (segment.type === "line") {
        return [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
    }

    if (segment.type === "arc") {
        const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
        let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
        if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
        if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;

        const points: Point2D[] = [];
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
        const points: Point2D[] = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            points.push({
                x: mt * mt * segment.x1 + 2 * mt * t * segment.cpx + t * t * segment.x2,
                y: mt * mt * segment.y1 + 2 * mt * t * segment.cpy + t * t * segment.y2,
            });
        }
        return points;
    }

    const points: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        points.push({
            x:
                mt * mt * mt * segment.x1 +
                3 * mt * mt * t * segment.cp1x +
                3 * mt * t * t * segment.cp2x +
                t * t * t * segment.x2,
            y:
                mt * mt * mt * segment.y1 +
                3 * mt * mt * t * segment.cp1y +
                3 * mt * t * t * segment.cp2y +
                t * t * t * segment.y2,
        });
    }
    return points;
}

function flattenModifierSegments(segments: ModifierPathSegment[], closed: boolean): Point2D[] {
    const points: Point2D[] = [];
    segments.forEach((segment, index) => {
        const sampled = sampleModifierSegmentPoints(segment);
        if (index === 0) points.push(...sampled);
        else points.push(...sampled.slice(1));
    });
    return closed ? stripDuplicateClosingPoint(points) : points;
}

function buildCornerLabels(points: Point2D[], closed: boolean): string[] {
    const stripped = closed ? stripDuplicateClosingPoint(points) : points;
    const count = stripped.length;
    const labels: string[] = [];
    const segCount = closed ? count : Math.max(0, count - 1);
    for (let i = 0; i < segCount; i++) {
        labels.push(String((i + 1) % count));
    }
    return labels;
}

function resolveCornerModifiers(
    corner: PathObject["corner"] | PolygonObject["corner"] | undefined,
    corners: PathObject["corners"] | PolygonObject["corners"] | undefined,
    ctx: ResolveContext
): CornerModifiers | undefined {
    const evalCtx = createEvalContext(ctx);
    const result: CornerModifiers = {};

    if (corner?.all) {
        const modifier: { fillet?: number; chamfer?: number } = {};
        if (corner.all.fillet !== undefined) {
            modifier.fillet = normalizeUnit(evaluateExpression(corner.all.fillet, evalCtx), ctx.targetUnit);
        }
        if (corner.all.chamfer !== undefined) {
            modifier.chamfer = normalizeUnit(evaluateExpression(corner.all.chamfer, evalCtx), ctx.targetUnit);
        }
        if (modifier.fillet !== undefined || modifier.chamfer !== undefined) {
            result.all = modifier as any;
        }
    }

    if (corners) {
        for (const [label, spec] of Object.entries(corners)) {
            const modifier: { fillet?: number; chamfer?: number } = {};
            if (spec.fillet !== undefined) {
                modifier.fillet = normalizeUnit(evaluateExpression(spec.fillet, evalCtx), ctx.targetUnit);
            }
            if (spec.chamfer !== undefined) {
                modifier.chamfer = normalizeUnit(evaluateExpression(spec.chamfer, evalCtx), ctx.targetUnit);
            }
            if (modifier.fillet !== undefined || modifier.chamfer !== undefined) {
                result[label] = modifier as any;
            }
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

function resolveTangentPoint(
    source: { x: number; y: number },
    target: any,
    pick: "first" | "last" | number | string | undefined
) {
    const center = target.type === "circle"
        ? { x: target.cx, y: target.cy }
        : { x: target.cx, y: target.cy };
    const radius = target.radius;

    if (center.x === undefined || center.y === undefined || radius === undefined) {
        throw new ResolveError("Tangent target does not expose circle geometry", "TANGENT_NOT_FOUND");
    }

    const dx = source.x - center.x;
    const dy = source.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < radius - 1e-6 || distance === 0) {
        throw new ResolveError("No valid tangent from source point to target", "TANGENT_NOT_FOUND");
    }

    const baseAngle = Math.atan2(dy, dx);
    const alpha = Math.acos(Math.min(1, radius / distance));
    const candidates = [baseAngle - alpha, baseAngle + alpha]
        .map((angle) => ({
            angle: normalizeAngle(angle),
            point: {
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
            },
        }))
        .sort((a, b) => a.angle - b.angle);

    let filtered = candidates;
    if (target.type === "arc" && target.startAngle !== undefined && target.endAngle !== undefined) {
        filtered = candidates.filter((candidate) => isAngleBetween(target.startAngle, target.endAngle, candidate.angle));
    }

    if (filtered.length === 0) {
        throw new ResolveError("No tangent point lies on the target arc", "TANGENT_NOT_FOUND");
    }

    if (pick === "last") return filtered[filtered.length - 1].point;
    if (typeof pick === "number" || (typeof pick === "string" && /^\d+$/.test(pick))) {
        const index = typeof pick === "number" ? pick : parseInt(pick, 10);
        if (filtered[index]) return filtered[index].point;
    }
    return filtered[0].point;
}

export function resolveRect(id: string, obj: RectObject, ctx: ResolveContext): ResolvedRect {
    const evalCtx = createEvalContext(ctx);
    let width = 0;
    let height = 0;

    try {
        width = normalizeUnit(evaluateExpression(obj.size[0], evalCtx), ctx.targetUnit);
        height = normalizeUnit(evaluateExpression(obj.size[1], evalCtx), ctx.targetUnit);
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "size");
    }

    const bbox = { x: 0, y: 0, width, height };
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const resolved: ResolvedRect = {
        id,
        type: "rect",
        x: dx,
        y: dy,
        width,
        height,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    const outerPoints = [
        { x: dx, y: dy },
        { x: dx + width, y: dy },
        { x: dx + width, y: dy + height },
        { x: dx, y: dy + height },
    ];
    if (obj.holes && obj.holes.length > 0) {
        resolved.holes = resolveHolesProperty(id, obj.holes, outerPoints, ctx, resolved);
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

export function resolveLine(id: string, obj: LineObject, ctx: ResolveContext): ResolvedLine {
    const evalCtx = createEvalContext(ctx);
    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;

    try {
        const p1 = resolveAnchorValue(obj.from || [0, 0], ctx);
        x1 = typeof p1 === "number" ? p1 : p1.x;
        y1 = typeof p1 === "number" ? p1 : p1.y;

        if (obj.to) {
            const p2 = resolveAnchorValue(obj.to, ctx);
            x2 = typeof p2 === "number" ? p2 : p2.x;
            y2 = typeof p2 === "number" ? p2 : p2.y;
        } else if (obj.tangent) {
            const source = resolvePointRef(obj.tangent.from, ctx);
            const tangentTarget = ctx.objects[obj.tangent.to];
            if (!tangentTarget) {
                throw new ResolveError(`Unknown tangent target: ${obj.tangent.to}`, "UNKNOWN_REFERENCE", obj.tangent.to);
            }
            if (!["circle", "arc"].includes(tangentTarget.type)) {
                throw new ResolveError(`Tangent runtime not implemented for target type "${tangentTarget.type}"`, "UNSUPPORTED_FEATURE", obj.tangent.to);
            }
            const tangentPoint = resolveTangentPoint(source, tangentTarget, obj.tangent.pick);
            x1 = source.x;
            y1 = source.y;
            x2 = tangentPoint.x;
            y2 = tangentPoint.y;
        } else if (obj.length !== undefined && obj.direction !== undefined) {
            const len = normalizeUnit(evaluateExpression(obj.length, evalCtx), ctx.targetUnit);
            const dir = obj.direction;
            if (dir === "right") { x2 = x1 + len; y2 = y1; }
            else if (dir === "left") { x2 = x1 - len; y2 = y1; }
            else if (dir === "down") { x2 = x1; y2 = y1 + len; }
            else if (dir === "up") { x2 = x1; y2 = y1 - len; }
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "line resolution");
    }

    const bbox = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
    };
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const resolved: ResolvedLine = {
        id,
        type: "line",
        x1: x1 + dx,
        y1: y1 + dy,
        x2: x2 + dx,
        y2: y2 + dy,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

export function resolveCircle(id: string, obj: CircleObject, ctx: ResolveContext): ResolvedCircle {
    const evalCtx = createEvalContext(ctx);
    let radius = 0;
    let cx = 0;
    let cy = 0;

    try {
        if (obj.center) {
            const p = resolveAnchorValue(obj.center, ctx);
            cx = typeof p === "number" ? p : p.x;
            cy = typeof p === "number" ? p : p.y;
        }

        if (obj.radius !== undefined) {
            radius = normalizeUnit(evaluateExpression(obj.radius, evalCtx), ctx.targetUnit);
        } else if (obj.through) {
            const tp = resolveAnchorValue(obj.through, ctx);
            const tx = typeof tp === "number" ? tp : tp.x;
            const ty = typeof tp === "number" ? tp : tp.y;
            radius = Math.sqrt(Math.pow(tx - cx, 2) + Math.pow(ty - cy, 2));
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "circle resolution");
    }

    const bbox = { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 };
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const resolved: ResolvedCircle = {
        id,
        type: "circle",
        cx: cx + dx,
        cy: cy + dy,
        radius,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    const outerPoints = [];
    const segmentsCount = 64;
    for (let i = 0; i < segmentsCount; i++) {
        const angle = (i * 2 * Math.PI) / segmentsCount;
        outerPoints.push({
            x: cx + dx + radius * Math.cos(angle),
            y: cy + dy + radius * Math.sin(angle),
        });
    }
    if (obj.holes && obj.holes.length > 0) {
        resolved.holes = resolveHolesProperty(id, obj.holes, outerPoints, ctx, resolved);
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

export function resolveEllipse(id: string, obj: EllipseObject, ctx: ResolveContext): ResolvedEllipse {
    const evalCtx = createEvalContext(ctx);
    let cx = 0;
    let cy = 0;
    let rx = 0;
    let ry = 0;
    let rotation = 0;

    try {
        if (obj.center) {
            const p = resolveAnchorValue(obj.center, ctx);
            cx = typeof p === "number" ? p : p.x;
            cy = typeof p === "number" ? p : p.y;
        }

        if (obj.size !== undefined && (obj.rx !== undefined || obj.ry !== undefined)) {
            throw new ResolveError(
                "Ellipse cannot define size together with rx or ry",
                "ELLIPSE_SIZE_CONFLICT",
                id
            );
        }

        if (obj.size) {
            rx = normalizeUnit(evaluateExpression(obj.size[0], evalCtx), ctx.targetUnit) / 2;
            ry = normalizeUnit(evaluateExpression(obj.size[1], evalCtx), ctx.targetUnit) / 2;
        } else {
            if (obj.rx !== undefined) {
                rx = normalizeUnit(evaluateExpression(obj.rx, evalCtx), ctx.targetUnit);
            }
            if (obj.ry !== undefined) {
                ry = normalizeUnit(evaluateExpression(obj.ry, evalCtx), ctx.targetUnit);
            }
        }

        if (obj.rotation !== undefined) {
            rotation = evaluateExpression(obj.rotation, evalCtx);
        }

        if (rx <= 0 || ry <= 0) {
            throw new ResolveError(
                "Ellipse rx and ry must be positive",
                "ELLIPSE_INVALID_RADIUS",
                id
            );
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "ellipse resolution");
    }

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const halfWidth = Math.sqrt((rx * cos) ** 2 + (ry * sin) ** 2);
    const halfHeight = Math.sqrt((rx * sin) ** 2 + (ry * cos) ** 2);
    const bbox = {
        x: cx - halfWidth,
        y: cy - halfHeight,
        width: halfWidth * 2,
        height: halfHeight * 2,
    };
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const resolved: ResolvedEllipse = {
        id,
        type: "ellipse",
        cx: cx + dx,
        cy: cy + dy,
        rx,
        ry,
        rotation,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    const outerPoints = [];
    const segmentsCount = 64;
    for (let i = 0; i < segmentsCount; i++) {
        const angle = (i * 2 * Math.PI) / segmentsCount;
        const localX = rx * Math.cos(angle);
        const localY = ry * Math.sin(angle);
        outerPoints.push({
            x: cx + dx + localX * cos - localY * sin,
            y: cy + dy + localX * sin + localY * cos,
        });
    }
    if (obj.holes && obj.holes.length > 0) {
        resolved.holes = resolveHolesProperty(id, obj.holes, outerPoints, ctx, resolved);
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

export function resolveArc(id: string, obj: ArcObject, ctx: ResolveContext): ResolvedArc {
    const evalCtx = createEvalContext(ctx);

    try {
        if (obj.from && obj.through && obj.to) {
            const from = resolvePointRef(obj.from, ctx);
            const through = resolvePointRef(obj.through, ctx);
            const to = resolvePointRef(obj.to, ctx);
            const center = getCircumcenter(from, through, to);
            const radius = Math.hypot(from.x - center.x, from.y - center.y);
            const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
            const throughAngle = Math.atan2(through.y - center.y, through.x - center.x);
            const rawEndAngle = Math.atan2(to.y - center.y, to.x - center.x);
            const forwardThrough = isAngleBetween(startAngle, rawEndAngle, throughAngle);
            const sweep = forwardThrough ? 1 : 0;

            let endAngle = rawEndAngle;
            if (sweep === 1 && endAngle < startAngle) {
                endAngle += Math.PI * 2;
            } else if (sweep === 0 && endAngle > startAngle) {
                endAngle -= Math.PI * 2;
            }

            const delta = Math.abs(endAngle - startAngle);
            const largeArc: 0 | 1 = delta > Math.PI ? 1 : 0;

            const bbox = getPathBBoxFromSegments([{
                type: "arc",
                x1: from.x,
                y1: from.y,
                xt: through.x,
                yt: through.y,
                x2: to.x,
                y2: to.y,
                cx: center.x,
                cy: center.y,
                radius,
                sweep,
                largeArc
            }]);

            const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

            const resolved: ResolvedArc = {
                id,
                type: "arc",
                x1: from.x + dx,
                y1: from.y + dy,
                xt: through.x + dx,
                yt: through.y + dy,
                x2: to.x + dx,
                y2: to.y + dy,
                cx: center.x + dx,
                cy: center.y + dy,
                radius,
                startAngle,
                endAngle,
                sweep,
                largeArc,
                transform: resolvedTransform,
                meta: obj.meta,
            };

            resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
            return resolved;
        }

        if (obj.center && obj.radius !== undefined && obj.startAngle !== undefined && obj.endAngle !== undefined) {
            const center = resolvePointRef(obj.center, ctx);
            const radius = normalizeUnit(evaluateExpression(obj.radius, evalCtx), ctx.targetUnit);
            if (radius <= 0) {
                throw new ResolveError("Arc radius must be positive", "DEGENERATE_ARC");
            }

            const startAngle = evaluateExpression(obj.startAngle, evalCtx);
            const endAngle = evaluateExpression(obj.endAngle, evalCtx);
            const x1 = center.x + radius * Math.cos(startAngle);
            const y1 = center.y + radius * Math.sin(startAngle);
            const x2 = center.x + radius * Math.cos(endAngle);
            const y2 = center.y + radius * Math.sin(endAngle);
            const delta = endAngle - startAngle;
            const sweep: 0 | 1 = delta >= 0 ? 1 : 0;
            const largeArc: 0 | 1 = Math.abs(delta) > Math.PI ? 1 : 0;

            const bbox = getPathBBoxFromSegments([{
                type: "arc",
                x1,
                y1,
                x2,
                y2,
                cx: center.x,
                cy: center.y,
                radius,
                sweep,
                largeArc
            }]);

            const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

            const resolved: ResolvedArc = {
                id,
                type: "arc",
                x1: x1 + dx,
                y1: y1 + dy,
                x2: x2 + dx,
                y2: y2 + dy,
                cx: center.x + dx,
                cy: center.y + dy,
                radius,
                startAngle,
                endAngle,
                sweep,
                largeArc,
                transform: resolvedTransform,
                meta: obj.meta,
            };

            resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
            return resolved;
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "arc resolution");
    }

    const fallback: ResolvedArc = {
        id,
        type: "arc",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        cx: 0,
        cy: 0,
        radius: 0,
        startAngle: 0,
        endAngle: 0,
        sweep: 1,
        largeArc: 0,
        meta: obj.meta,
    };
    fallback.anchors = resolveCustomAnchors(obj, fallback, ctx);
    return fallback;
}

export function resolveQuadratic(id: string, obj: QuadraticObject, ctx: ResolveContext): ResolvedQuadratic {
    try {
        const from = resolvePointRef(obj.from, ctx);
        const cp = resolvePointRef(obj.cp, ctx);
        const to = resolvePointRef(obj.to, ctx);

        const bbox = getPathBBoxFromSegments([{
            type: "quadratic",
            x1: from.x,
            y1: from.y,
            cpx: cp.x,
            cpy: cp.y,
            x2: to.x,
            y2: to.y
        }]);

        const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

        const resolved: ResolvedQuadratic = {
            id,
            type: "quadratic",
            x1: from.x + dx,
            y1: from.y + dy,
            cpx: cp.x + dx,
            cpy: cp.y + dy,
            x2: to.x + dx,
            y2: to.y + dy,
            transform: resolvedTransform,
            meta: obj.meta,
        };

        resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
        return resolved;
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "quadratic resolution");
    }

    const fallback: ResolvedQuadratic = {
        id,
        type: "quadratic",
        x1: 0,
        y1: 0,
        cpx: 0,
        cpy: 0,
        x2: 0,
        y2: 0,
        meta: obj.meta,
    };
    fallback.anchors = resolveCustomAnchors(obj, fallback, ctx);
    return fallback;
}

export function resolveCubic(id: string, obj: CubicObject, ctx: ResolveContext): ResolvedCubic {
    try {
        const from = resolvePointRef(obj.from, ctx);
        const cp1 = resolvePointRef(obj.cp1, ctx);
        const cp2 = resolvePointRef(obj.cp2, ctx);
        const to = resolvePointRef(obj.to, ctx);

        const bbox = getPathBBoxFromSegments([{
            type: "cubic",
            x1: from.x,
            y1: from.y,
            cp1x: cp1.x,
            cp1y: cp1.y,
            cp2x: cp2.x,
            cp2y: cp2.y,
            x2: to.x,
            y2: to.y
        }]);

        const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

        const resolved: ResolvedCubic = {
            id,
            type: "cubic",
            x1: from.x + dx,
            y1: from.y + dy,
            cp1x: cp1.x + dx,
            cp1y: cp1.y + dy,
            cp2x: cp2.x + dx,
            cp2y: cp2.y + dy,
            x2: to.x + dx,
            y2: to.y + dy,
            transform: resolvedTransform,
            meta: obj.meta,
        };

        resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
        return resolved;
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "cubic resolution");
    }

    const fallback: ResolvedCubic = {
        id,
        type: "cubic",
        x1: 0,
        y1: 0,
        cp1x: 0,
        cp1y: 0,
        cp2x: 0,
        cp2y: 0,
        x2: 0,
        y2: 0,
        meta: obj.meta,
    };
    fallback.anchors = resolveCustomAnchors(obj, fallback, ctx);
    return fallback;
}

function parseFontSize(val: string | number | undefined, defaultVal: number): number {
    if (typeof val === "number") return val;
    if (typeof val !== "string") return defaultVal;
    const clean = val.toLowerCase().trim();
    const num = parseFloat(clean);
    if (isNaN(num)) return defaultVal;
    if (clean.endsWith("pt")) return num * 1.333333;
    if (clean.endsWith("em") || clean.endsWith("rem")) return num * 16;
    return num;
}

export function resolveText(id: string, obj: TextObject, ctx: ResolveContext): ResolvedText {
    const evalCtx = createEvalContext(ctx);
    let anchorX = 0;
    let anchorY = 0;
    let content: string | number = obj.content as any;

    if (typeof obj.content === "string") {
        try {
            content = obj.content.replace(/\{([^{}]+)\}/g, (_match, expr) => {
                const value = evaluateExpression(expr.trim(), evalCtx);
                return String(value);
            });
        } catch (e) {
            if (ctx.mode !== "editor") wrapError(e, id, "content");
        }
    }

    const textString = String(content ?? "");

    const fontSize = parseFontSize(obj.meta?.fontSize as string | number | undefined, 12);
    const fontFamily = typeof obj.meta?.fontFamily === "string" ? obj.meta.fontFamily : undefined;
    const fontWeight = obj.meta?.fontWeight as string | number | undefined;
    const fontStyle = obj.meta?.fontStyle as "normal" | "italic" | "oblique" | undefined;
    const lineHeight = parseFontSize(obj.meta?.lineHeight as string | number | undefined, 1);

    const metrics = ctx.textMetrics.measure({
        content: textString,
        fontSize: isNaN(fontSize) ? 12 : fontSize,
        fontFamily,
        fontWeight,
        fontStyle,
        lineHeight: isNaN(lineHeight) ? 1 : lineHeight
    });

    const width = metrics.width;
    const height = metrics.height;
    // RelGeo 0.5 freezes text's implicit anchor as the bounding-box center.
    // Keep the legacy top-left default for pre-0.5 documents so older scenes
    // retain their established placement semantics.
    const documentVersion = Number(ctx.doc?.version ?? 0);
    const anchor = obj.anchor ?? (documentVersion >= 0.5 ? "center" : "topLeft");

    try {
        if (obj.at) {
            const p = resolveAnchorValue(obj.at, ctx);
            anchorX = typeof p === "number" ? p : p.x;
            anchorY = typeof p === "number" ? p : p.y;
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id, "at");
    }

    let x = anchorX;
    let y = anchorY;
    if (anchor === "topCenter") x -= width / 2;
    else if (anchor === "topRight") x -= width;
    else if (anchor === "centerLeft") y -= height / 2;
    else if (anchor === "center") {
        x -= width / 2;
        y -= height / 2;
    } else if (anchor === "centerRight") {
        x -= width;
        y -= height / 2;
    } else if (anchor === "bottomLeft") y -= height;
    else if (anchor === "bottomCenter") {
        x -= width / 2;
        y -= height;
    } else if (anchor === "bottomRight") {
        x -= width;
        y -= height;
    }

    const bbox = { x, y, width, height };
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(
        obj.place ? { ...obj, at: undefined } : obj,
        bbox,
        ctx
    );

    const resolved: ResolvedText = {
        id,
        type: "text",
        x: x + dx,
        y: y + dy,
        width,
        height,
        content,
        anchor,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

function validateHolesTopology(
    outerPoints: Point2D[],
    holes: Point2D[][],
    pathId: string,
    ctx: ResolveContext
): void {
    if (ctx.mode === "editor") return;

    const outerPoly = stripDuplicateClosingPoint(outerPoints);
    if (outerPoly.length < 3) return;

    // Helper: Point in polygon (ray casting)
    const isPointInside = (p: Point2D, poly: Point2D[]): boolean => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y))
                && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    // Helper: Check if point is on the polygon boundary (with tolerance)
    const TOL = 1e-7;
    const isPointOnBoundary = (p: Point2D, poly: Point2D[]): boolean => {
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
            if (Math.abs(cross) > TOL) continue;
            const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
            if (dot < -TOL) continue;
            const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
            if (dot <= lenSq + TOL) return true;
        }
        return false;
    };

    // Helper: Check if two polygon boundaries cross/intersect
    const doPolysIntersect = (poly1: Point2D[], poly2: Point2D[]): boolean => {
        const intersectSegments = (
            p1: Point2D, p2: Point2D,
            q1: Point2D, q2: Point2D
        ): boolean => {
            const det = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
            if (Math.abs(det) < TOL) return false;
            const u = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / det;
            const v = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / det;
            return u > TOL && u < 1 - TOL && v > TOL && v < 1 - TOL;
        };

        for (let i = 0; i < poly1.length; i++) {
            const p1 = poly1[i];
            const p2 = poly1[(i + 1) % poly1.length];
            for (let j = 0; j < poly2.length; j++) {
                const q1 = poly2[j];
                const q2 = poly2[(j + 1) % poly2.length];
                if (intersectSegments(p1, p2, q1, q2)) return true;
            }
        }
        return false;
    };

    holes.forEach((hole, i) => {
        const holePoly = stripDuplicateClosingPoint(hole);
        if (holePoly.length < 3) return;

        // 1. Verify all hole vertices are inside or on the boundary of outer poly
        let strictlyInside = true;
        for (const pt of holePoly) {
            const inside = isPointInside(pt, outerPoly);
            const onBoundary = isPointOnBoundary(pt, outerPoly);
            if (!inside && !onBoundary) {
                strictlyInside = false;
                break;
            }
        }
        if (!strictlyInside) {
            throw new ResolveError(
                `Hole ${i} in path "${pathId}" is outside the outer boundary`,
                "HOLE_OUTSIDE_BOUNDARY",
                pathId,
                `holes[${i}]`
            );
        }

        // Also check centroid
        const cx = holePoly.reduce((sum, p) => sum + p.x, 0) / holePoly.length;
        const cy = holePoly.reduce((sum, p) => sum + p.y, 0) / holePoly.length;
        if (!isPointInside({ x: cx, y: cy }, outerPoly)) {
            throw new ResolveError(
                `Hole ${i} in path "${pathId}" is outside the outer boundary`,
                "HOLE_OUTSIDE_BOUNDARY",
                pathId,
                `holes[${i}]`
            );
        }

        // Check if the hole poly crosses/intersects the outer boundary (partially outside)
        if (doPolysIntersect(outerPoly, holePoly)) {
            throw new ResolveError(
                `Hole ${i} in path "${pathId}" intersects the outer boundary (partially outside)`,
                "HOLE_OUTSIDE_BOUNDARY",
                pathId,
                `holes[${i}]`
            );
        }

        // 2. Check overlap/nesting with other holes
        for (let j = i + 1; j < holes.length; j++) {
            const otherHolePoly = stripDuplicateClosingPoint(holes[j]);
            if (otherHolePoly.length < 3) continue;

            if (doPolysIntersect(holePoly, otherHolePoly)) {
                throw new ResolveError(
                    `Hole ${i} and Hole ${j} in path "${pathId}" overlap each other`,
                    "HOLE_OVERLAP",
                    pathId,
                    `holes[${i}]`
                );
            }

            const firstCentroid = { x: cx, y: cy };
            const secondCx = otherHolePoly.reduce((sum, p) => sum + p.x, 0) / otherHolePoly.length;
            const secondCy = otherHolePoly.reduce((sum, p) => sum + p.y, 0) / otherHolePoly.length;
            const secondCentroid = { x: secondCx, y: secondCy };

            if (isPointInside(firstCentroid, otherHolePoly) || isPointInside(secondCentroid, holePoly)) {
                throw new ResolveError(
                    `Hole ${i} and Hole ${j} in path "${pathId}" overlap or are nested`,
                    "HOLE_OVERLAP",
                    pathId,
                    `holes[${i}]`
                );
            }
        }
    });
}

export function resolvePath(id: string, obj: PathObject, ctx: ResolveContext): ResolvedPath {
    let resolvedPoints: { x: number; y: number }[] = [];
    let resolvedSegments: ResolvedPath["segments"];
    let resolvedClosed = obj.closed;

    let resolvedHolesResult: { segments: PathResolvedSegment[] }[] | undefined;
    try {
        if (obj.offset) {
            const source = ctx.objects[obj.offset.from];
            if (!source) {
                throw new ResolveError(`Unknown offset source: ${obj.offset.from}`, "UNKNOWN_REFERENCE", obj.offset.from, "offset.from");
            }
            const evalCtx = createEvalContext(ctx);
            const distance = normalizeUnit(evaluateExpression(obj.offset.distance, evalCtx), ctx.targetUnit);
            const side = obj.offset.side ?? "left";
            const { points: sourcePoints, closed } = getPathSourcePointsAndClosed(source, id);
            const normalizedSourcePoints = closed ? stripDuplicateClosingPoint(sourcePoints) : sourcePoints;
            validateNoSelfIntersection(normalizedSourcePoints, closed, obj.offset.from);
            const offsetPoints = offsetPolyline(normalizedSourcePoints, distance, side, closed, id);
            if (closed) {
                validateNoSelfIntersection(offsetPoints, true, id);
            }
            resolvedPoints = offsetPoints;
            resolvedSegments = buildLineSegmentsFromPoints(offsetPoints, closed) as ResolvedPath["segments"];
            resolvedClosed = obj.closed ?? closed;
        } else if (obj.join?.length) {
            const joinedSegments: PathResolvedSegment[] = [];
            obj.join.forEach((targetId, index) => {
                const source = ctx.objects[targetId];
                const targetSegments = getJoinableSegmentsFromObject(targetId, source, ctx);
                if (targetSegments.length === 0) {
                    throw new ResolveError(
                        `Join target "${targetId}" did not produce any usable segments`,
                        "INVALID_JOIN_TARGET",
                        id,
                        `join[${index}]`
                    );
                }
                if (joinedSegments.length > 0) {
                    const previousEnd = getSegmentEnd(joinedSegments[joinedSegments.length - 1]);
                    const currentStart = getSegmentStart(targetSegments[0]);
                    if (!pointsCoincide(previousEnd, currentStart)) {
                        const currentEnd = getSegmentEnd(targetSegments[targetSegments.length - 1]);
                        const code = pointsCoincide(previousEnd, currentEnd)
                            ? "PATH_JOIN_DIRECTION_MISMATCH"
                            : "PATH_JOIN_GAP";
                        throw new ResolveError(
                            `Join item "${targetId}" is not connected to the previous item`,
                            code,
                            id,
                            `join[${index}]`
                        );
                    }
                }
                joinedSegments.push(...targetSegments);
            });

            if (resolvedClosed && (obj.closeWith ?? "none") === "line" && joinedSegments.length > 0) {
                const lastEnd = getSegmentEnd(joinedSegments[joinedSegments.length - 1]);
                const firstStart = getSegmentStart(joinedSegments[0]);
                if (!pointsCoincide(lastEnd, firstStart)) {
                    joinedSegments.push({
                        type: "line",
                        x1: lastEnd.x,
                        y1: lastEnd.y,
                        x2: firstStart.x,
                        y2: firstStart.y,
                    });
                }
            }

            resolvedSegments = joinedSegments;
            resolvedPoints = aggregatePointsFromSegments(joinedSegments);
        } else if (obj.segments?.length) {
            resolvedSegments = resolveSegmentsInternal(obj.segments, ctx);
            resolvedPoints = aggregatePointsFromSegments(resolvedSegments);
            const cornerMap = resolveCornerModifiers(obj.corner, obj.corners, ctx);
            if (cornerMap && resolvedPoints.length > 1) {
                const closed = obj.closed === true;
                const cornerLabels = buildCornerLabels(resolvedPoints, closed);
                const modifiedSegments = applyCornerModifiers(resolvedSegments as ModifierPathSegment[], cornerLabels, cornerMap, closed, id);
                resolvedSegments = modifiedSegments as ResolvedPath["segments"];
                resolvedPoints = pointsFromSegments(modifiedSegments, closed);
            }
        } else {
            const points = obj.points || [];
            resolvedPoints = points.map((ref: AnchorRef) => resolvePointRef(ref, ctx));
            const cornerMap = resolveCornerModifiers(obj.corner, obj.corners, ctx);
            if (cornerMap && resolvedPoints.length > 1) {
                const closed = obj.closed === true;
                const normalizedPoints = closed ? stripDuplicateClosingPoint(resolvedPoints) : resolvedPoints;
                const baseSegments = buildLineSegmentsFromPoints(normalizedPoints, closed);
                const cornerLabels = buildCornerLabels(normalizedPoints, closed);
                const modifiedSegments = applyCornerModifiers(baseSegments, cornerLabels, cornerMap, closed, id);
                resolvedSegments = modifiedSegments as ResolvedPath["segments"];
                resolvedPoints = pointsFromSegments(modifiedSegments, closed);
            }
        }
    } catch (e) {
        if (ctx.mode !== "editor") wrapError(e, id);
    }

    if (resolvedClosed) {
        const isClosedBySegments =
            resolvedSegments &&
            resolvedSegments.length > 0 &&
            pointsCoincide(
                { x: resolvedSegments[0].x1, y: resolvedSegments[0].y1 },
                { x: resolvedSegments[resolvedSegments.length - 1].x2, y: resolvedSegments[resolvedSegments.length - 1].y2 }
            );
        const isClosedByPoints =
            resolvedPoints.length > 1 &&
            pointsCoincide(resolvedPoints[0], resolvedPoints[resolvedPoints.length - 1]);

        if (!isClosedBySegments && !isClosedByPoints && ctx.mode !== "editor") {
            throw new ResolveError(
                `Path "${id}" is declared closed but its start and end points do not coincide`,
                "PATH_NOT_CLOSED",
                id,
                "closed"
            );
        }
    }

    const bbox = resolvedSegments && resolvedSegments.length > 0
        ? getPathBBoxFromSegments(resolvedSegments)
        : getPathBBox(resolvedPoints);
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const translatedPoints = resolvedPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    const translatedSegments = resolvedSegments?.map((segment) => {
        if (segment.type === "line") {
            return { ...segment, x1: segment.x1 + dx, y1: segment.y1 + dy, x2: segment.x2 + dx, y2: segment.y2 + dy };
        }
        if (segment.type === "arc") {
            return {
                ...segment,
                x1: segment.x1 + dx,
                y1: segment.y1 + dy,
                xt: segment.xt !== undefined ? segment.xt + dx : undefined,
                yt: segment.yt !== undefined ? segment.yt + dy : undefined,
                x2: segment.x2 + dx,
                y2: segment.y2 + dy,
            };
        }
        if (segment.type === "quadratic") {
            return {
                ...segment,
                x1: segment.x1 + dx,
                y1: segment.y1 + dy,
                cpx: segment.cpx + dx,
                cpy: segment.cpy + dy,
                x2: segment.x2 + dx,
                y2: segment.y2 + dy,
            };
        }
        return {
            ...segment,
            x1: segment.x1 + dx,
            y1: segment.y1 + dy,
            cp1x: segment.cp1x + dx,
            cp1y: segment.cp1y + dy,
            cp2x: segment.cp2x + dx,
            cp2y: segment.cp2y + dy,
            x2: segment.x2 + dx,
            y2: segment.y2 + dy,
        };
    });

    const resolved: ResolvedPath = {
        id,
        type: "path",
        points: translatedPoints,
        segments: translatedSegments,
        closed: resolvedClosed,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    if (obj.holes && obj.holes.length > 0) {
        resolved.holes = resolveHolesProperty(id, obj.holes, translatedPoints, ctx, resolved);
    } else if (resolvedHolesResult) {
        resolved.holes = resolvedHolesResult.map((hole: any) => ({
            segments: hole.segments.map((s: PathResolvedSegment) => translateSegment(s, dx, dy))
        }));
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

export function resolvePolygon(id: string, obj: PolygonObject, ctx: ResolveContext): ResolvedPolygon {
    const points = obj.points.map((ref: AnchorRef) => resolvePointRef(ref, ctx));
    const cornerMap = resolveCornerModifiers(obj.corner, obj.corners, ctx);
    let resolvedPoints = points;
    let resolvedSegments: ResolvedPolygon["segments"];

    if (cornerMap && points.length > 1) {
        const baseSegments = buildLineSegmentsFromPoints(points, true);
        const cornerLabels = buildCornerLabels(points, true);
        const modifiedSegments = applyCornerModifiers(baseSegments, cornerLabels, cornerMap, true, id);
        resolvedSegments = modifiedSegments as ResolvedPolygon["segments"];
        resolvedPoints = pointsFromSegments(modifiedSegments, true);
    }

    const bbox = resolvedSegments && (resolvedSegments as any).length > 0
        ? getPathBBoxFromSegments(resolvedSegments as any)
        : getPathBBox(resolvedPoints);
    
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    const translatedPoints = resolvedPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    const translatedSegments = (resolvedSegments as any)?.map((segment: any) => translateSegment(segment, dx, dy));

    const resolved: ResolvedPolygon = {
        id,
        type: "polygon" as const,
        points: translatedPoints,
        segments: translatedSegments,
        transform: resolvedTransform,
        meta: obj.meta,
    };

    if (obj.holes && obj.holes.length > 0) {
        resolved.holes = resolveHolesProperty(id, obj.holes, translatedPoints, ctx, resolved);
    }

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}

function resolveSegmentsInternal(objSegments: PathSegment[], ctx: ResolveContext): PathResolvedSegment[] {
    const segments: PathResolvedSegment[] = [];
    let currentPoint: { x: number; y: number } | undefined;

    objSegments.forEach((segment, index) => {
        if ("line" in segment) {
            if (index > 0 && segment.line.from !== undefined) {
                throw new ResolveError(`"from" is only allowed on the first path segment`, "UNKNOWN_FIELD", ctx.currentObjectId || "", `segments[${index}].line.from`);
            }
            const from = segment.line.from ? resolvePointRef(segment.line.from, ctx) : currentPoint;
            if (!from) {
                throw new ResolveError("First line segment requires an explicit from point", "MISSING_REQUIRED_FIELD");
            }
            const to = resolvePointRef(segment.line.to, ctx);
            segments.push({
                type: "line",
                x1: from.x,
                y1: from.y,
                x2: to.x,
                y2: to.y,
            });
            currentPoint = to;
        } else if ("arc" in segment) {
            if (index > 0 && segment.arc.from !== undefined) {
                throw new ResolveError(`"from" is only allowed on the first path segment`, "UNKNOWN_FIELD", ctx.currentObjectId || "", `segments[${index}].arc.from`);
            }
            const from = segment.arc.from ? resolvePointRef(segment.arc.from, ctx) : currentPoint;
            if (!from) throw new ResolveError("First arc segment requires an explicit from point", "MISSING_REQUIRED_FIELD");
            const through = resolvePointRef(segment.arc.through, ctx);
            const to = resolvePointRef(segment.arc.to, ctx);
            const center = getCircumcenter(from, through, to);
            const radius = Math.hypot(from.x - center.x, from.y - center.y);
            const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
            const throughAngle = Math.atan2(through.y - center.y, through.x - center.x);
            const rawEndAngle = Math.atan2(to.y - center.y, to.x - center.x);
            const forwardThrough = isAngleBetween(startAngle, rawEndAngle, throughAngle);
            const sweep: 0 | 1 = forwardThrough ? 1 : 0;

            let endAngle = rawEndAngle;
            if (sweep === 1 && endAngle < startAngle) {
                endAngle += Math.PI * 2;
            } else if (sweep === 0 && endAngle > startAngle) {
                endAngle -= Math.PI * 2;
            }
            const largeArc: 0 | 1 = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;

            segments.push({
                type: "arc",
                x1: from.x,
                y1: from.y,
                xt: through.x,
                yt: through.y,
                x2: to.x,
                y2: to.y,
                cx: center.x,
                cy: center.y,
                radius,
                sweep,
                largeArc,
            });
            currentPoint = to;
        } else if ("quadratic" in segment) {
            if (index > 0 && segment.quadratic.from !== undefined) {
                throw new ResolveError(`"from" is only allowed on the first path segment`, "UNKNOWN_FIELD", ctx.currentObjectId || "", `segments[${index}].quadratic.from`);
            }
            const from = segment.quadratic.from ? resolvePointRef(segment.quadratic.from, ctx) : currentPoint;
            if (!from) throw new ResolveError("First quadratic segment requires an explicit from point", "MISSING_REQUIRED_FIELD");
            const cp = resolvePointRef(segment.quadratic.cp, ctx);
            const to = resolvePointRef(segment.quadratic.to, ctx);
            segments.push({
                type: "quadratic",
                x1: from.x,
                y1: from.y,
                cpx: cp.x,
                cpy: cp.y,
                x2: to.x,
                y2: to.y,
            });
            currentPoint = to;
        } else if ("cubic" in segment) {
            if (index > 0 && segment.cubic.from !== undefined) {
                throw new ResolveError(`"from" is only allowed on the first path segment`, "UNKNOWN_FIELD", ctx.currentObjectId || "", `segments[${index}].cubic.from`);
            }
            const from = segment.cubic.from ? resolvePointRef(segment.cubic.from, ctx) : currentPoint;
            if (!from) throw new ResolveError("First cubic segment requires an explicit from point", "MISSING_REQUIRED_FIELD");
            const cp1 = resolvePointRef(segment.cubic.cp1, ctx);
            const cp2 = resolvePointRef(segment.cubic.cp2, ctx);
            const to = resolvePointRef(segment.cubic.to, ctx);
            segments.push({
                type: "cubic",
                x1: from.x,
                y1: from.y,
                cp1x: cp1.x,
                cp1y: cp1.y,
                cp2x: cp2.x,
                cp2y: cp2.y,
                x2: to.x,
                y2: to.y,
            });
            currentPoint = to;
        }
    });

    return segments;
}

function resolveHolesProperty(
    id: string,
    holes: any[] | undefined,
    resolvedOuterPoints: Point2D[],
    ctx: ResolveContext,
    parentResolved?: ResolvedObject
): { segments: PathResolvedSegment[] }[] | undefined {
    if (!holes || holes.length === 0) return undefined;
    const resolvedHolesResult: { segments: PathResolvedSegment[] }[] = [];
    const holeCtx: ResolveContext = parentResolved
        ? {
            ...ctx,
            objects: {
                ...ctx.objects,
                [id]: parentResolved,
            },
        }
        : ctx;
    holes.forEach((hole: any, i) => {
        let holeSegments: PathResolvedSegment[] = [];
        if (typeof hole === "string") {
            const resolvedHole = holeCtx.objects[hole];
            if (resolvedHole) {
                if (resolvedHole.type === "collection") {
                    for (const childId of resolvedHole.children) {
                        const childObj = holeCtx.objects[childId];
                        if (childObj) {
                            const normalized = normalizeClosedShape(childObj, holeCtx.objects);
                            const childHoleSegs = polyToSegments(normalized.outer);
                            if (childHoleSegs.length > 0) {
                                const start = { x: childHoleSegs[0].x1, y: childHoleSegs[0].y1 };
                                const end = { x: childHoleSegs[childHoleSegs.length - 1].x2, y: childHoleSegs[childHoleSegs.length - 1].y2 };
                                if (!pointsCoincide(start, end) && holeCtx.mode !== "editor") {
                                    throw new ResolveError(
                                        `Hole in collection "${hole}" is not closed`,
                                        "PATH_NOT_CLOSED",
                                        id,
                                        `holes[${i}]`
                                    );
                                }
                                resolvedHolesResult.push({ segments: childHoleSegs });
                            }
                        }
                    }
                    return;
                } else {
                    const normalized = normalizeClosedShape(resolvedHole, holeCtx.objects);
                    holeSegments = polyToSegments(normalized.outer);
                }
            } else {
                throw new ResolveError(
                    `Hole reference "${hole}" not found or not resolved`,
                    "UNKNOWN_IDENTIFIER",
                    id,
                    `holes[${i}]`
                );
            }
        } else if (hole && typeof hole === "object") {
            if (hole.segments) {
                holeSegments = resolveSegmentsInternal(hole.segments, holeCtx);
            } else if (hole.type) {
                const tempId = `${id}_hole_${i}`;
                let resolvedHole: any = undefined;
                if (hole.type === "rect") {
                    resolvedHole = resolveRect(tempId, hole, holeCtx);
                } else if (hole.type === "circle") {
                    resolvedHole = resolveCircle(tempId, hole, holeCtx);
                } else if (hole.type === "ellipse") {
                    resolvedHole = resolveEllipse(tempId, hole, holeCtx);
                } else if (hole.type === "polygon") {
                    resolvedHole = resolvePolygon(tempId, hole, holeCtx);
                } else if (hole.type === "path") {
                    resolvedHole = resolvePath(tempId, hole, holeCtx);
                } else if (hole.type === "boolean") {
                    resolvedHole = resolveBoolean(tempId, hole, holeCtx);
                } else if (hole.type === "clone") {
                    resolvedHole = resolveClone(tempId, hole, holeCtx);
                }
                if (resolvedHole) {
                    const normalized = normalizeClosedShape(resolvedHole, holeCtx.objects);
                    holeSegments = polyToSegments(normalized.outer);
                }
            }
        }

        if (holeSegments.length > 0) {
            const start = { x: holeSegments[0].x1, y: holeSegments[0].y1 };
            const end = { x: holeSegments[holeSegments.length - 1].x2, y: holeSegments[holeSegments.length - 1].y2 };
            if (!pointsCoincide(start, end) && holeCtx.mode !== "editor") {
                throw new ResolveError(
                    `Hole ${i} in shape "${id}" is not closed`,
                    "PATH_NOT_CLOSED",
                    id,
                    `holes[${i}]`
                );
            }
            resolvedHolesResult.push({ segments: holeSegments });
        }
    });

    if (resolvedHolesResult.length > 0) {
        const holePointsList: Point2D[][] = [];
        resolvedHolesResult.forEach((hole) => {
            holePointsList.push(pointsFromSegments(hole.segments as any, true));
        });
        validateHolesTopology(resolvedOuterPoints, holePointsList, id, holeCtx);
        return resolvedHolesResult;
    }
    return undefined;
}

function aggregatePointsFromSegments(segments: PathResolvedSegment[]): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    if (segments.length === 0) return pts;
    pts.push({ x: segments[0].x1, y: segments[0].y1 });
    segments.forEach(s => pts.push({ x: s.x2, y: s.y2 }));
    return pts;
}

function reverseResolvedSegment(segment: PathResolvedSegment): PathResolvedSegment {
    if (segment.type === "line") {
        return { type: "line", x1: segment.x2, y1: segment.y2, x2: segment.x1, y2: segment.y1 };
    }
    if (segment.type === "arc") {
        return {
            ...segment,
            x1: segment.x2,
            y1: segment.y2,
            x2: segment.x1,
            y2: segment.y1,
            sweep: segment.sweep === 1 ? 0 : 1,
        };
    }
    if (segment.type === "quadratic") {
        return {
            type: "quadratic",
            x1: segment.x2,
            y1: segment.y2,
            cpx: segment.cpx,
            cpy: segment.cpy,
            x2: segment.x1,
            y2: segment.y1,
        };
    }
    return {
        type: "cubic",
        x1: segment.x2,
        y1: segment.y2,
        cp1x: segment.cp2x,
        cp1y: segment.cp2y,
        cp2x: segment.cp1x,
        cp2y: segment.cp1y,
        x2: segment.x1,
        y2: segment.y1,
    };
}

function getSegmentStart(segment: PathResolvedSegment) {
    return { x: segment.x1, y: segment.y1 };
}

function getSegmentEnd(segment: PathResolvedSegment) {
    return { x: segment.x2, y: segment.y2 };
}

function applyOperationTransformToArcSegment(segment: Extract<PathResolvedSegment, { type: "arc" }>, transform: any, targetId: string): PathResolvedSegment {
    if (transform.type === "translate") {
        return translateSegment(segment, transform.x, transform.y);
    }

    const start = applyTransformPipeline({ x: segment.x1, y: segment.y1 }, [transform] as any);
    const end = applyTransformPipeline({ x: segment.x2, y: segment.y2 }, [transform] as any);
    const center = applyTransformPipeline({ x: segment.cx, y: segment.cy }, [transform] as any);
    const through = segment.xt !== undefined && segment.yt !== undefined
        ? applyTransformPipeline({ x: segment.xt, y: segment.yt }, [transform] as any)
        : undefined;

    if (transform.type === "rotate") {
        return {
            ...segment,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            xt: through?.x,
            yt: through?.y,
            cx: center.x,
            cy: center.y,
        };
    }

    if (transform.type === "mirror") {
        return {
            ...segment,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            xt: through?.x,
            yt: through?.y,
            cx: center.x,
            cy: center.y,
            sweep: segment.sweep === 1 ? 0 : 1,
        };
    }

    if (transform.type === "scale") {
        const [sx, sy] = transform.factor;
        if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9) {
            throw new ResolveError(
                `Join target "${targetId}" uses a non-uniformly scaled arc that cannot be lowered safely`,
                "INVALID_JOIN_TARGET",
                targetId
            );
        }
        return {
            ...segment,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            xt: through?.x,
            yt: through?.y,
            cx: center.x,
            cy: center.y,
            radius: segment.radius * Math.abs(sx),
        };
    }

    throw new ResolveError(`Unsupported transform for arc join target "${targetId}"`, "INVALID_JOIN_TARGET", targetId);
}

function applyOperationTransformToSegments(segments: PathResolvedSegment[], transform: any, targetId: string): PathResolvedSegment[] {
    return segments.map((segment) => {
        if (segment.type === "line") {
            const start = applyTransformPipeline({ x: segment.x1, y: segment.y1 }, [transform] as any);
            const end = applyTransformPipeline({ x: segment.x2, y: segment.y2 }, [transform] as any);
            return { type: "line", x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        }
        if (segment.type === "arc") {
            return applyOperationTransformToArcSegment(segment, transform, targetId);
        }
        if (segment.type === "quadratic") {
            const start = applyTransformPipeline({ x: segment.x1, y: segment.y1 }, [transform] as any);
            const cp = applyTransformPipeline({ x: segment.cpx, y: segment.cpy }, [transform] as any);
            const end = applyTransformPipeline({ x: segment.x2, y: segment.y2 }, [transform] as any);
            return { type: "quadratic", x1: start.x, y1: start.y, cpx: cp.x, cpy: cp.y, x2: end.x, y2: end.y };
        }
        const start = applyTransformPipeline({ x: segment.x1, y: segment.y1 }, [transform] as any);
        const cp1 = applyTransformPipeline({ x: segment.cp1x, y: segment.cp1y }, [transform] as any);
        const cp2 = applyTransformPipeline({ x: segment.cp2x, y: segment.cp2y }, [transform] as any);
        const end = applyTransformPipeline({ x: segment.x2, y: segment.y2 }, [transform] as any);
        return {
            type: "cubic",
            x1: start.x,
            y1: start.y,
            cp1x: cp1.x,
            cp1y: cp1.y,
            cp2x: cp2.x,
            cp2y: cp2.y,
            x2: end.x,
            y2: end.y,
        };
    });
}

function getJoinableSegmentsFromObject(targetId: string, source: any, ctx: ResolveContext): PathResolvedSegment[] {
    if (!source) {
        throw new ResolveError(`Unknown join target "${targetId}"`, "INVALID_JOIN_TARGET", targetId);
    }

    if (source.type === "reverse") {
        const target = ctx.objects[(source as any).target];
        const targetSegments = getJoinableSegmentsFromObject((source as any).target, target, ctx);
        return targetSegments.slice().reverse().map(reverseResolvedSegment);
    }

    if (source.type === "translate" || source.type === "rotate" || source.type === "scale" || source.type === "mirror") {
        const target = ctx.objects[(source as any).target];
        const targetSegments = getJoinableSegmentsFromObject((source as any).target, target, ctx);
        if (!source.transform || source.transform.length === 0) {
            return targetSegments;
        }
        return applyOperationTransformToSegments(targetSegments, source.transform[0], targetId);
    }

    if (source.type === "line") {
        return [{ type: "line", x1: source.x1, y1: source.y1, x2: source.x2, y2: source.y2 }];
    }
    if (source.type === "arc") {
        return [{
            type: "arc",
            x1: source.x1,
            y1: source.y1,
            xt: source.xt,
            yt: source.yt,
            x2: source.x2,
            y2: source.y2,
            cx: source.cx,
            cy: source.cy,
            radius: source.radius,
            sweep: source.sweep,
            largeArc: source.largeArc,
        }];
    }
    if (source.type === "quadratic") {
        return [{ type: "quadratic", x1: source.x1, y1: source.y1, cpx: source.cpx, cpy: source.cpy, x2: source.x2, y2: source.y2 }];
    }
    if (source.type === "cubic") {
        return [{
            type: "cubic",
            x1: source.x1,
            y1: source.y1,
            cp1x: source.cp1x,
            cp1y: source.cp1y,
            cp2x: source.cp2x,
            cp2y: source.cp2y,
            x2: source.x2,
            y2: source.y2,
        }];
    }
    if ((source.type === "path" || source.type === "polygon" || source.type === "boolean") && Array.isArray(source.segments) && source.segments.length > 0) {
        return source.segments.map((segment: PathResolvedSegment) => ({ ...segment }));
    }
    if (source.type === "path" && Array.isArray(source.points) && source.points.length > 1) {
        return buildLineSegmentsFromPoints(stripDuplicateClosingPoint(source.points), source.closed === true);
    }
    if ((source.type === "polygon" || source.type === "boolean") && Array.isArray(source.points) && source.points.length > 1) {
        return buildLineSegmentsFromPoints(stripDuplicateClosingPoint(source.points), true);
    }

    throw new ResolveError(
        `Join target "${targetId}" is not a valid path-like object`,
        "INVALID_JOIN_TARGET",
        targetId
    );
}

function translateSegment(s: PathResolvedSegment, dx: number, dy: number): PathResolvedSegment {
    if (s.type === "line") {
        return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    }
    if (s.type === "arc") {
        return {
            ...s,
            x1: s.x1 + dx, y1: s.y1 + dy,
            x2: s.x2 + dx, y2: s.y2 + dy,
            xt: s.xt !== undefined ? s.xt + dx : undefined,
            yt: s.yt !== undefined ? s.yt + dy : undefined,
            cx: s.cx + dx, cy: s.cy + dy
        };
    }
    if (s.type === "quadratic") {
        return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, cpx: s.cpx + dx, cpy: s.cpy + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    }
    return {
        ...s,
        x1: s.x1 + dx, y1: s.y1 + dy,
        cp1x: s.cp1x + dx, cp1y: s.cp1y + dy,
        cp2x: s.cp2x + dx, cp2y: s.cp2y + dy,
        x2: s.x2 + dx, y2: s.y2 + dy
    };
}

export function resolveBoolean(id: string, obj: BooleanObject, ctx: ResolveContext): ResolvedBoolean {
    const engine = new ClipperBooleanEngine();
    let polyResults: PolyWithHoles[] = [];
    const path = `objects.${id}`;

    if (obj.operation !== "subtract" && obj.operation !== "union" && obj.operation !== "intersect" && obj.operation !== "xor") {
        throw new ResolveError(
            `Unknown or missing boolean operation: "${obj.operation}"`,
            "INVALID_BOOLEAN_OPERATION",
            id,
            path,
        );
    }

    try {
        if (obj.operation === "subtract") {
            const raw = obj as any;
            if (!raw.base) {
                throw new ResolveError(
                    `Subtract operation is missing required "base" property`,
                    "INVALID_BOOLEAN_OPERATION",
                    id,
                    path,
                );
            }
            if (!raw.tools || raw.tools.length === 0) {
                throw new ResolveError(
                    `Subtract operation is missing required "tools" property`,
                    "INVALID_BOOLEAN_OPERATION",
                    id,
                    path,
                );
            }
            const baseObj = ctx.objects[raw.base];
            if (!baseObj) throw new Error(`Unknown base object for subtract: ${raw.base}`);
            const toolObjs = (raw.tools || []).map((tId: string) => {
                const tObj = ctx.objects[tId];
                if (!tObj) throw new Error(`Unknown tool object for subtract: ${tId}`);
                return tObj;
            });
            polyResults = engine.subtract(
                normalizeClosedShape(baseObj, ctx.objects),
                toolObjs.map((t: any) => normalizeClosedShape(t, ctx.objects))
            );
        } else {
            const raw = obj as any;
            if (!raw.shapes || raw.shapes.length === 0) {
                throw new ResolveError(
                    `Boolean operation "${obj.operation}" requires "shapes" property`,
                    "INVALID_BOOLEAN_OPERATION",
                    id,
                    path,
                );
            }
            const operandObjs = (raw.shapes || []).map((sId: string) => {
                const sObj = ctx.objects[sId];
                if (!sObj) throw new Error(`Unknown shape operand for boolean: ${sId}`);
                return sObj;
            });
            const normalizedOperands = operandObjs.map((o: any) => normalizeClosedShape(o, ctx.objects));
            if (obj.operation === "union") {
                polyResults = engine.union(normalizedOperands);
            } else if (obj.operation === "intersect") {
                polyResults = engine.intersect(normalizedOperands);
            } else if (obj.operation === "xor") {
                polyResults = engine.xor(normalizedOperands);
            }
        }
    } catch (e: any) {
        if (ctx.mode !== "editor") {
            if (e instanceof ResolveError) throw e;
            throw new ResolveError(e.message, "BOOLEAN_FAILED", id, path);
        }
    }

    if (polyResults.length === 0 && ctx.mode !== "editor") {
        throw new ResolveError(
            `Boolean operation "${obj.operation}" produced an empty result`,
            "BOOLEAN_EMPTY_RESULT",
            id,
            path,
        );
    }

    // 2. Multi-part checking
    const mode = obj.result?.mode || "single";
    if (mode === "single" && polyResults.length > 1) {
        throw new ResolveError(
            `Boolean operation produced multipart result (islands) but result.mode was set to "single"`,
            "BOOLEAN_MULTIPART_RESULT",
            id,
            path
        );
    }

    // 3. Flatten results
    const points: { x: number; y: number }[] = [];
    const segments: PathResolvedSegment[] = [];
    const holes: { segments: PathResolvedSegment[] }[] = [];

    for (const island of polyResults) {
        points.push(...island.outer);
        segments.push(...polyToSegments(island.outer));
        if (island.holes) {
            for (const h of island.holes) {
                holes.push({ segments: polyToSegments(h) });
            }
        }
    }

    // 4. Bounding Box & Alignment placement
    let bbox = { x: 0, y: 0, width: 0, height: 0 };
    if (points.length > 0) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        bbox = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    // Apply offset translations to final flattened shapes
    const translatedPoints = points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    const translatedSegments = segments.map(s => translateSegment(s, dx, dy));
    const translatedHoles = holes.map(h => ({
        segments: h.segments.map(s => translateSegment(s, dx, dy))
    }));

    const resolved: ResolvedBoolean = {
        id,
        type: "boolean",
        operation: obj.operation,
        points: translatedPoints,
        segments: translatedSegments,
        holes: translatedHoles,
        transform: resolvedTransform,
        meta: obj.meta
    };

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx);
    return resolved;
}
