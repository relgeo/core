import { evaluateExpression } from "../evaluator";
import { normalizeUnit } from "../units";
import { applyGroupTransform } from "./transform-utils";
import { ResolveContext, ResolveError } from "./types";
import { normalizeErrorCode, stripErrorCodePrefix } from "../errors";
import { createEvalContext } from "./eval-context";
import { calculateBoundingBox } from "./geometry-utils";
import type { AnchorRef } from "../types";

function bboxFromPoints(points: { x: number; y: number }[]) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
    };
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

function polygonArea(points: { x: number; y: number }[]) {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
}

function polylineLength(points: { x: number; y: number }[]) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
}

function approximateQuadraticLength(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 24
) {
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

function approximateCubicLength(
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p1: { x: number; y: number },
    steps = 32
) {
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

function sampleSegmentLikePoints(segment: any, steps = 32): { x: number; y: number }[] {
    if (segment.type === "line") {
        return [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
    }

    if (segment.type === "arc") {
        const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
        let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
        if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
        if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;

        const points: { x: number; y: number }[] = [];
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

    const points: { x: number; y: number }[] = [];
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

function pointsFromSegments(segments: any[]): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    segments.forEach((segment, index) => {
        const sampled = sampleSegmentLikePoints(segment);
        if (index === 0) {
            points.push(...sampled);
        } else {
            points.push(...sampled.slice(1));
        }
    });
    return points;
}

function bboxFromSegments(segments: any[]) {
    if (segments.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
    }

    const points: { x: number; y: number }[] = [];
    segments.forEach((segment) => {
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

        if (segment.type === "line") {
            points.push({ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
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

    return bboxFromPoints(points);
}

export function resolveAnchorValue(ref: unknown, ctx: ResolveContext): any {
    if (typeof ref === "number") return ref;

    const evalCtx = createEvalContext(ctx);

    if (Array.isArray(ref) && ref.length === 2) {
        return {
            x: normalizeUnit(evaluateExpression(ref[0], evalCtx), ctx.targetUnit),
            y: normalizeUnit(evaluateExpression(ref[1], evalCtx), ctx.targetUnit)
        };
    }

    if (typeof ref !== "string") {
        throw new ResolveError(`Invalid reference type: ${typeof ref}`, "TYPE_MISMATCH");
    }

    // Default fallback to center anchor if it's a simple identifier representing a geometry object
    if (!/[+\-*/()\[\.]/.test(ref)) {
        const target = ctx.objects[ref];
        if (target) {
            return getAnchorValue(target, "center", ctx);
        }
    }

    try {
        return evaluateExpression(ref, evalCtx);
    } catch (e: any) {
        const rawMessage = e instanceof Error ? e.message : String(e);
        const code = normalizeErrorCode(e?.code, rawMessage, "INVALID_EXPRESSION");
        throw new ResolveError(
            stripErrorCodePrefix(rawMessage || `Error resolving expression: ${ref}`),
            code,
        );
    }
}

export function getAnchorValue(obj: any, anchor: string, ctx?: ResolveContext): any {
    let val = getRawAnchorValue(obj, anchor, ctx);

    // Apply Coordinate Space Rules (v0.2 Delta)
    if (ctx && ctx.parentMap && ctx.currentObjectId && obj && obj.id) {
        if (isPointLike(val)) {
            val = applyTransforms(val, obj.id, ctx);
        } else if (typeof val === "number") {
            const axis = getAnchorAxis(anchor);
            if (axis === "x") {
                const refY = getRawAnchorValue(obj, "centerY", ctx) || getRawAnchorValue(obj, "y", ctx) || 0;
                const p = applyTransforms({ x: val, y: refY }, obj.id, ctx);
                val = p.x;
            } else if (axis === "y") {
                const refX = getRawAnchorValue(obj, "centerX", ctx) || getRawAnchorValue(obj, "x", ctx) || 0;
                const p = applyTransforms({ x: refX, y: val }, obj.id, ctx);
                val = p.y;
            }
        }
    }

    return val;
}

export function getNestedAnchorValue(obj: any, parts: string[], ctx?: ResolveContext): any {
    let current: any = obj;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
            return getAnchorValue(current, part, ctx);
        } else {
            current = getRawAnchorValue(current, part, ctx);
            if (current === undefined) return undefined;
        }
    }
    return current;
}

function getRawAnchorValue(obj: any, anchor: string, ctx?: ResolveContext): any {
    if (!obj) return undefined;

    // Handle nested property access for point-like objects
    if (isPointLike(obj)) {
        if (anchor === "x") return obj.x;
        if (anchor === "y") return obj.y;
    }

    // 1. Check custom anchors (v0.2)
    if (obj.anchors && obj.anchors[anchor] !== undefined) {
        const custom = obj.anchors[anchor];
        if (Array.isArray(custom) && custom.length === 2) {
            return { x: custom[0], y: custom[1] };
        }
        return custom;
    }

    // 2. Check built-in anchors based on type
    switch (obj.type) {
        case "point":
            if (anchor === "x") return obj.x;
            if (anchor === "y") return obj.y;
            if (anchor === "center") return { x: obj.x, y: obj.y };
            break;

        case "rect":
            if (anchor === "left" || anchor === "x") return obj.x;
            if (anchor === "right") return obj.x + obj.width;
            if (anchor === "top" || anchor === "y") return obj.y;
            if (anchor === "bottom") return obj.y + obj.height;
            if (anchor === "width") return obj.width;
            if (anchor === "height") return obj.height;
            if (anchor === "area") {
                let a = obj.width * obj.height;
                if (obj.holes && obj.holes.length > 0) {
                    obj.holes.forEach((hole: any) => {
                        const holePts = pointsFromSegments(hole.segments);
                        a -= polygonArea(holePts);
                    });
                }
                return Math.max(0, a);
            }
            if (anchor === "centerX") return obj.x + obj.width / 2;
            if (anchor === "centerY") return obj.y + obj.height / 2;
            if (anchor === "center") return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
            if (anchor === "topLeft") return { x: obj.x, y: obj.y };
            if (anchor === "topRight") return { x: obj.x + obj.width, y: obj.y };
            if (anchor === "bottomLeft") return { x: obj.x, y: obj.y + obj.height };
            if (anchor === "bottomRight") return { x: obj.x + obj.width, y: obj.y + obj.height };
            if (anchor === "topCenter") return { x: obj.x + obj.width / 2, y: obj.y };
            if (anchor === "bottomCenter") return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
            if (anchor === "centerLeft") return { x: obj.x, y: obj.y + obj.height / 2 };
            if (anchor === "centerRight") return { x: obj.x + obj.width, y: obj.y + obj.height / 2 };
            break;

        case "line":
            if (anchor === "start") return { x: obj.x1, y: obj.y1 };
            if (anchor === "end") return { x: obj.x2, y: obj.y2 };
            if (anchor === "center") return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
            if (anchor === "length") return Math.sqrt((obj.x2 - obj.x1) ** 2 + (obj.y2 - obj.y1) ** 2);
            break;

        case "circle":
            if (anchor === "cx" || anchor === "x") return obj.cx;
            if (anchor === "cy" || anchor === "y") return obj.cy;
            if (anchor === "radius" || anchor === "r") return obj.radius;
            if (anchor === "left") return obj.cx - obj.radius;
            if (anchor === "right") return obj.cx + obj.radius;
            if (anchor === "top") return obj.cy - obj.radius;
            if (anchor === "bottom") return obj.cy + obj.radius;
            if (anchor === "centerX") return obj.cx;
            if (anchor === "centerY") return obj.cy;
            if (anchor === "width") return obj.radius * 2;
            if (anchor === "height") return obj.radius * 2;
            if (anchor === "area") {
                let a = Math.PI * obj.radius * obj.radius;
                if (obj.holes && obj.holes.length > 0) {
                    obj.holes.forEach((hole: any) => {
                        const holePts = pointsFromSegments(hole.segments);
                        a -= polygonArea(holePts);
                    });
                }
                return Math.max(0, a);
            }
            if (anchor === "center") return { x: obj.cx, y: obj.cy };
            if (anchor === "topLeft") return { x: obj.cx - obj.radius, y: obj.cy - obj.radius };
            if (anchor === "topCenter") return { x: obj.cx, y: obj.cy - obj.radius };
            if (anchor === "topRight") return { x: obj.cx + obj.radius, y: obj.cy - obj.radius };
            if (anchor === "centerLeft") return { x: obj.cx - obj.radius, y: obj.cy };
            if (anchor === "centerRight") return { x: obj.cx + obj.radius, y: obj.cy };
            if (anchor === "bottomLeft") return { x: obj.cx - obj.radius, y: obj.cy + obj.radius };
            if (anchor === "bottomCenter") return { x: obj.cx, y: obj.cy + obj.radius };
            if (anchor === "bottomRight") return { x: obj.cx + obj.radius, y: obj.cy + obj.radius };
            break;

        case "ellipse": {
            const rotation = obj.rotation ?? 0;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const halfWidth = Math.sqrt((obj.rx * cos) ** 2 + (obj.ry * sin) ** 2);
            const halfHeight = Math.sqrt((obj.rx * sin) ** 2 + (obj.ry * cos) ** 2);
            if (anchor === "cx" || anchor === "x") return obj.cx;
            if (anchor === "cy" || anchor === "y") return obj.cy;
            if (anchor === "rx") return obj.rx;
            if (anchor === "ry") return obj.ry;
            if (anchor === "rotation") return rotation;
            if (anchor === "left") return obj.cx - halfWidth;
            if (anchor === "right") return obj.cx + halfWidth;
            if (anchor === "top") return obj.cy - halfHeight;
            if (anchor === "bottom") return obj.cy + halfHeight;
            if (anchor === "centerX") return obj.cx;
            if (anchor === "centerY") return obj.cy;
            if (anchor === "width") return halfWidth * 2;
            if (anchor === "height") return halfHeight * 2;
            if (anchor === "area") return Math.PI * obj.rx * obj.ry;
            if (anchor === "perimeter") {
                const h = ((obj.rx - obj.ry) ** 2) / ((obj.rx + obj.ry) ** 2);
                return Math.PI * (obj.rx + obj.ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
            }
            if (anchor === "center") return { x: obj.cx, y: obj.cy };
            if (anchor === "topLeft") return { x: obj.cx - halfWidth, y: obj.cy - halfHeight };
            if (anchor === "topCenter") return { x: obj.cx, y: obj.cy - halfHeight };
            if (anchor === "topRight") return { x: obj.cx + halfWidth, y: obj.cy - halfHeight };
            if (anchor === "centerLeft") return { x: obj.cx - halfWidth, y: obj.cy };
            if (anchor === "centerRight") return { x: obj.cx + halfWidth, y: obj.cy };
            if (anchor === "bottomLeft") return { x: obj.cx - halfWidth, y: obj.cy + halfHeight };
            if (anchor === "bottomCenter") return { x: obj.cx, y: obj.cy + halfHeight };
            if (anchor === "bottomRight") return { x: obj.cx + halfWidth, y: obj.cy + halfHeight };
            break;
        }

        case "arc":
            if (
                anchor === "left" ||
                anchor === "right" ||
                anchor === "top" ||
                anchor === "bottom" ||
                anchor === "width" ||
                anchor === "height"
            ) {
                const pts = [
                    { x: obj.x1, y: obj.y1 },
                    { x: obj.x2, y: obj.y2 },
                    ...(obj.xt !== undefined && obj.yt !== undefined ? [{ x: obj.xt, y: obj.yt }] : []),
                ];
                const bbox = bboxFromPoints(pts);
                if (anchor === "left") return bbox.minX;
                if (anchor === "right") return bbox.maxX;
                if (anchor === "top") return bbox.minY;
                if (anchor === "bottom") return bbox.maxY;
                if (anchor === "width") return bbox.width;
                if (anchor === "height") return bbox.height;
            }
            if (anchor === "start") return { x: obj.x1, y: obj.y1 };
            if (anchor === "end") return { x: obj.x2, y: obj.y2 };
            if (anchor === "through" && obj.xt !== undefined && obj.yt !== undefined) {
                return { x: obj.xt, y: obj.yt };
            }
            if (anchor === "center") return { x: obj.cx, y: obj.cy };
            if (anchor === "centerX" || anchor === "cx" || anchor === "x") return obj.cx;
            if (anchor === "centerY" || anchor === "cy" || anchor === "y") return obj.cy;
            if (anchor === "radius" || anchor === "r") return obj.radius;
            if (anchor === "length" && obj.radius !== undefined && obj.startAngle !== undefined && obj.endAngle !== undefined) {
                return obj.radius * Math.abs(obj.endAngle - obj.startAngle);
            }
            break;

        case "quadratic":
            if (
                anchor === "left" ||
                anchor === "right" ||
                anchor === "top" ||
                anchor === "bottom" ||
                anchor === "width" ||
                anchor === "height" ||
                anchor === "centerX" ||
                anchor === "centerY"
            ) {
                const bbox = bboxFromPoints(
                    sampleSegmentLikePoints({
                        type: "quadratic",
                        x1: obj.x1,
                        y1: obj.y1,
                        cpx: obj.cpx,
                        cpy: obj.cpy,
                        x2: obj.x2,
                        y2: obj.y2,
                    }, 48)
                );
                if (anchor === "left") return bbox.minX;
                if (anchor === "right") return bbox.maxX;
                if (anchor === "top") return bbox.minY;
                if (anchor === "bottom") return bbox.maxY;
                if (anchor === "width") return bbox.width;
                if (anchor === "height") return bbox.height;
                if (anchor === "centerX") return bbox.centerX;
                if (anchor === "centerY") return bbox.centerY;
            }
            if (anchor === "start") return { x: obj.x1, y: obj.y1 };
            if (anchor === "cp") return { x: obj.cpx, y: obj.cpy };
            if (anchor === "end") return { x: obj.x2, y: obj.y2 };
            if (anchor === "length") {
                return approximateQuadraticLength(
                    { x: obj.x1, y: obj.y1 },
                    { x: obj.cpx, y: obj.cpy },
                    { x: obj.x2, y: obj.y2 }
                );
            }
            if (anchor === "center") {
                return {
                    x: (obj.x1 + obj.cpx + obj.x2) / 3,
                    y: (obj.y1 + obj.cpy + obj.y2) / 3,
                };
            }
            break;

        case "cubic":
            if (
                anchor === "left" ||
                anchor === "right" ||
                anchor === "top" ||
                anchor === "bottom" ||
                anchor === "width" ||
                anchor === "height" ||
                anchor === "centerX" ||
                anchor === "centerY"
            ) {
                const bbox = bboxFromPoints(
                    sampleSegmentLikePoints({
                        type: "cubic",
                        x1: obj.x1,
                        y1: obj.y1,
                        cp1x: obj.cp1x,
                        cp1y: obj.cp1y,
                        cp2x: obj.cp2x,
                        cp2y: obj.cp2y,
                        x2: obj.x2,
                        y2: obj.y2,
                    }, 64)
                );
                if (anchor === "left") return bbox.minX;
                if (anchor === "right") return bbox.maxX;
                if (anchor === "top") return bbox.minY;
                if (anchor === "bottom") return bbox.maxY;
                if (anchor === "width") return bbox.width;
                if (anchor === "height") return bbox.height;
                if (anchor === "centerX") return bbox.centerX;
                if (anchor === "centerY") return bbox.centerY;
            }
            if (anchor === "start") return { x: obj.x1, y: obj.y1 };
            if (anchor === "cp1") return { x: obj.cp1x, y: obj.cp1y };
            if (anchor === "cp2") return { x: obj.cp2x, y: obj.cp2y };
            if (anchor === "end") return { x: obj.x2, y: obj.y2 };
            if (anchor === "length") {
                return approximateCubicLength(
                    { x: obj.x1, y: obj.y1 },
                    { x: obj.cp1x, y: obj.cp1y },
                    { x: obj.cp2x, y: obj.cp2y },
                    { x: obj.x2, y: obj.y2 }
                );
            }
            if (anchor === "center") {
                return {
                    x: (obj.x1 + obj.cp1x + obj.cp2x + obj.x2) / 4,
                    y: (obj.y1 + obj.cp1y + obj.cp2y + obj.y2) / 4,
                };
            }
            break;

        case "boolean":
        case "path": {
            const points = obj.points ?? [];
            const segments = obj.segments ?? [];
            const hasSegments = Array.isArray(segments) && segments.length > 0;
            const pathPoints = hasSegments ? pointsFromSegments(segments) : points;
            if (pathPoints.length > 0) {
                const bbox = hasSegments ? bboxFromSegments(segments) : bboxFromPoints(pathPoints);
                if (anchor === "left" || anchor === "x") return bbox.minX;
                if (anchor === "right") return bbox.maxX;
                if (anchor === "top" || anchor === "y") return bbox.minY;
                if (anchor === "bottom") return bbox.maxY;
                if (anchor === "width") return bbox.width;
                if (anchor === "height") return bbox.height;
                if (anchor === "centerX") return bbox.centerX;
                if (anchor === "centerY") return bbox.centerY;
                if (anchor === "center") return { x: bbox.centerX, y: bbox.centerY };
                if (anchor === "topLeft") return { x: bbox.minX, y: bbox.minY };
                if (anchor === "topCenter") return { x: bbox.centerX, y: bbox.minY };
                if (anchor === "topRight") return { x: bbox.maxX, y: bbox.minY };
                if (anchor === "centerLeft") return { x: bbox.minX, y: bbox.centerY };
                if (anchor === "centerRight") return { x: bbox.maxX, y: bbox.centerY };
                if (anchor === "bottomLeft") return { x: bbox.minX, y: bbox.maxY };
                if (anchor === "bottomCenter") return { x: bbox.centerX, y: bbox.maxY };
                if (anchor === "bottomRight") return { x: bbox.maxX, y: bbox.maxY };
                if (anchor === "start") return pathPoints[0];
                if (anchor === "end") return pathPoints[pathPoints.length - 1];
                if (anchor === "length") {
                    if (hasSegments) {
                        return segments.reduce((sum: number, segment: any) => {
                            if (segment.type === "line") {
                                return sum + Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
                            }
                            if (segment.type === "arc") {
                                const startAngle = Math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx);
                                let endAngle = Math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx);
                                if (segment.sweep === 1 && endAngle < startAngle) endAngle += Math.PI * 2;
                                if (segment.sweep === 0 && endAngle > startAngle) endAngle -= Math.PI * 2;
                                return sum + segment.radius * Math.abs(endAngle - startAngle);
                            }
                            if (segment.type === "quadratic") {
                                return sum + approximateQuadraticLength(
                                    { x: segment.x1, y: segment.y1 },
                                    { x: segment.cpx, y: segment.cpy },
                                    { x: segment.x2, y: segment.y2 }
                                );
                            }
                            return sum + approximateCubicLength(
                                { x: segment.x1, y: segment.y1 },
                                { x: segment.cp1x, y: segment.cp1y },
                                { x: segment.cp2x, y: segment.cp2y },
                                { x: segment.x2, y: segment.y2 }
                            );
                        }, 0);
                    }
                    return polylineLength(pathPoints);
                }
                if (anchor === "area" && (obj.closed || obj.type === "boolean")) {
                    if (hasSegments) {
                        const loops: any[][] = [];
                        let currentLoop: any[] = [];
                        for (const seg of segments) {
                            if (currentLoop.length === 0) {
                                currentLoop.push(seg);
                            } else {
                                const prev = currentLoop[currentLoop.length - 1];
                                const distance = Math.hypot(seg.x1 - prev.x2, seg.y1 - prev.y2);
                                if (distance > 1e-3) {
                                    loops.push(currentLoop);
                                    currentLoop = [seg];
                                } else {
                                    currentLoop.push(seg);
                                }
                            }
                        }
                        if (currentLoop.length > 0) {
                            loops.push(currentLoop);
                        }

                        let totalArea = 0;
                        for (const loop of loops) {
                            const loopPts = pointsFromSegments(loop);
                            totalArea += polygonArea(loopPts);
                        }
                        if (obj.holes && obj.holes.length > 0) {
                            obj.holes.forEach((hole: any) => {
                                const holePts = pointsFromSegments(hole.segments);
                                totalArea -= polygonArea(holePts);
                            });
                        }
                        return Math.max(0, totalArea);
                    } else {
                        let totalArea = polygonArea(pathPoints);
                        if (obj.holes && obj.holes.length > 0) {
                            obj.holes.forEach((hole: any) => {
                                const holePts = pointsFromSegments(hole.segments);
                                totalArea -= polygonArea(holePts);
                            });
                        }
                        return Math.max(0, totalArea);
                    }
                }
            }
            break;
        }

        case "text":
            if (anchor === "x" || anchor === "left") return obj.x;
            if (anchor === "y" || anchor === "top") return obj.y;
            if (anchor === "right") return obj.x + obj.width;
            if (anchor === "bottom") return obj.y + obj.height;
            if (anchor === "centerX") return obj.x + obj.width / 2;
            if (anchor === "centerY") return obj.y + obj.height / 2;
            if (anchor === "center") return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
            if (anchor === "topLeft") return { x: obj.x, y: obj.y };
            if (anchor === "topCenter") return { x: obj.x + obj.width / 2, y: obj.y };
            if (anchor === "topRight") return { x: obj.x + obj.width, y: obj.y };
            if (anchor === "centerLeft") return { x: obj.x, y: obj.y + obj.height / 2 };
            if (anchor === "centerRight") return { x: obj.x + obj.width, y: obj.y + obj.height / 2 };
            if (anchor === "bottomLeft") return { x: obj.x, y: obj.y + obj.height };
            if (anchor === "bottomCenter") return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
            if (anchor === "bottomRight") return { x: obj.x + obj.width, y: obj.y + obj.height };
            break;

        case "polygon": {
            const points = obj.points ?? [];
            const segments = obj.segments ?? [];
            const hasSegments = Array.isArray(segments) && segments.length > 0;
            const polygonPoints = hasSegments ? pointsFromSegments(segments) : points;
            const bbox = hasSegments ? bboxFromSegments(segments) : bboxFromPoints(polygonPoints);
            if (anchor === "left" || anchor === "x") return bbox.minX;
            if (anchor === "right") return bbox.maxX;
            if (anchor === "top" || anchor === "y") return bbox.minY;
            if (anchor === "bottom") return bbox.maxY;
            if (anchor === "width") return bbox.width;
            if (anchor === "height") return bbox.height;
            if (anchor === "centerX") return bbox.centerX;
            if (anchor === "centerY") return bbox.centerY;
            if (anchor === "area") {
                let a = polygonArea(polygonPoints);
                if (obj.holes && obj.holes.length > 0) {
                    obj.holes.forEach((hole: any) => {
                        const holePts = pointsFromSegments(hole.segments);
                        a -= polygonArea(holePts);
                    });
                }
                return Math.max(0, a);
            }
            if (anchor === "center") return { x: bbox.centerX, y: bbox.centerY };
            if (anchor === "topLeft") return { x: bbox.minX, y: bbox.minY };
            if (anchor === "topCenter") return { x: bbox.centerX, y: bbox.minY };
            if (anchor === "topRight") return { x: bbox.maxX, y: bbox.minY };
            if (anchor === "centerLeft") return { x: bbox.minX, y: bbox.centerY };
            if (anchor === "centerRight") return { x: bbox.maxX, y: bbox.centerY };
            if (anchor === "bottomLeft") return { x: bbox.minX, y: bbox.maxY };
            if (anchor === "bottomCenter") return { x: bbox.centerX, y: bbox.maxY };
            if (anchor === "bottomRight") return { x: bbox.maxX, y: bbox.maxY };
            break;
        }
            break;

        case "group":
        case "clone":
        case "translate":
        case "rotate":
        case "scale":
        case "mirror":
        case "reverse": {
            // 1. Derived/group-like objects proxy anchors from their source when possible.
            if (obj.type !== "group" && ctx) {
                const sourceId = (obj as any).of ?? (obj as any).target;
                const source = ctx.objects[sourceId];
                if (source) {
                    const proxiedAnchor = obj.type === "reverse"
                        ? (anchor === "start" ? "end" : anchor === "end" ? "start" : anchor)
                        : anchor;
                    // Get RAW point from source, parent caller will apply OUR transform
                    const val = getRawAnchorValue(source, proxiedAnchor, ctx);
                    if (val !== undefined) return val;
                }
            }

            // 2. Otherwise, treat as a group for built-in anchors
            const childObjects: Record<string, any> = {};
            if (ctx && ctx.objects) {
                const sourceId = (obj as any).of ?? (obj as any).target;
                const sourceObj = sourceId ? ctx.objects[sourceId] : undefined;
                const children = obj.type === "group"
                    ? (obj as any).children
                    : (sourceObj?.type === "group" ? (sourceObj as any).children : [sourceId]);
                children.forEach((childId: string) => {
                    if (ctx.objects[childId]) {
                        childObjects[childId] = ctx.objects[childId];
                    }
                });
            }
            const bbox = calculateBoundingBox(childObjects);
            if (anchor === "left" || anchor === "x") return bbox.x;
            if (anchor === "right") return bbox.x + bbox.width;
            if (anchor === "top" || anchor === "y") return bbox.y;
            if (anchor === "bottom") return bbox.y + bbox.height;
            if (anchor === "width") return bbox.width;
            if (anchor === "height") return bbox.height;
            if (anchor === "centerX") return bbox.x + bbox.width / 2;
            if (anchor === "centerY") return bbox.y + bbox.height / 2;
            if (anchor === "center") return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            if (anchor === "topLeft") return { x: bbox.x, y: bbox.y };
            if (anchor === "topRight") return { x: bbox.x + bbox.width, y: bbox.y };
            if (anchor === "bottomLeft") return { x: bbox.x, y: bbox.y + bbox.height };
            if (anchor === "bottomRight") return { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
            break;
        }
    }

    return undefined;
}

function applyTransforms(point: { x: number; y: number }, targetId: string, ctx: ResolveContext): { x: number; y: number } {
    let p = { ...point };

    const targetPath = getParentChain(targetId, ctx.parentMap!);
    const requesterPath = getParentChain(ctx.currentObjectId!, ctx.parentMap!);

    let commonAncestor: string | undefined;
    for (const id of targetPath) {
        if (requesterPath.includes(id)) {
            commonAncestor = id;
            break;
        }
    }

    let itId: string | undefined = targetId;
    while (itId && itId !== commonAncestor) {
        const obj = ctx.objects[itId];
        if (
            obj &&
            (obj.type === "group" ||
                obj.type === "clone" ||
                obj.type === "translate" ||
                obj.type === "rotate" ||
                obj.type === "scale" ||
                obj.type === "mirror" ||
                obj.type === "reverse")
        ) {
            p = applyGroupTransform(p, obj as any);
        }
        itId = ctx.parentMap!.get(itId);
    }

    return p;
}

function getParentChain(id: string, parentMap: Map<string, string>): string[] {
    const chain: string[] = [];
    let current: string | undefined = id;
    while (current) {
        chain.push(current);
        current = parentMap.get(current);
    }
    return chain;
}

export function isPointLike(value: any): value is { x: number; y: number } {
    return value && typeof value.x === "number" && typeof value.y === "number";
}

export function getAnchorAxis(anchorPath: string): "x" | "y" | "point" | null {
    if (
        anchorPath === "left" ||
        anchorPath === "right" ||
        anchorPath === "centerX" ||
        anchorPath === "x" ||
        anchorPath === "cx" ||
        anchorPath.endsWith(".x")
    ) {
        return "x";
    }

    if (
        anchorPath === "top" ||
        anchorPath === "bottom" ||
        anchorPath === "centerY" ||
        anchorPath === "y" ||
        anchorPath === "cy" ||
        anchorPath.endsWith(".y")
    ) {
        return "y";
    }

    if (
        anchorPath === "center" ||
        anchorPath === "start" ||
        anchorPath === "end" ||
        anchorPath === "topLeft" ||
        anchorPath === "topRight" ||
        anchorPath === "bottomLeft" ||
        anchorPath === "bottomRight"
    ) {
        return "point";
    }

    return null;
}
