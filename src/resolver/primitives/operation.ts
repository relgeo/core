import type {
    MirrorObject,
    PathResolvedSegment,
    ResolvedObject,
    ReverseObject,
    RotateObject,
    ScaleObject,
    SplitObject,
    TranslateObject,
} from "../../types";
import { evaluateExpression } from "../../evaluator";
import { splitPathLikeByPoint, type SplitSupportedTarget, type Point2D } from "@relgeo/geometry";
import { normalizeUnit } from "../../units";
import { createEvalContext } from "../eval-context";
import { resolveAnchorValue } from "../anchors";
import { calculateBoundingBox } from "../geometry-utils";
import { applyTransformPipeline } from "../transform-utils";
import { ResolveContext, ResolveError } from "../types";
import { resolveCustomAnchors } from "./utils";

type GeometryOperationObject =
    | TranslateObject
    | RotateObject
    | ScaleObject
    | MirrorObject
    | ReverseObject
    | SplitObject;

const REVERSIBLE_TARGET_TYPES = new Set([
    "line",
    "arc",
    "circle",
    "ellipse",
    "rect",
    "quadratic",
    "cubic",
    "path",
    "polygon",
    "boolean",
]);

const SPLITTABLE_OPERATION_TARGET_TYPES = new Set([
    "line",
    "arc",
    "quadratic",
    "cubic",
    "path",
    "reverse",
    "translate",
    "rotate",
    "scale",
    "mirror",
]);
const GEOMETRY_OPERATION_TARGET_TYPES = new Set([
    "point", "line", "rect", "circle", "ellipse", "arc", "quadratic", "cubic",
    "path", "polygon", "boolean", "group", "clone", "translate", "rotate",
    "scale", "mirror", "reverse", "split",
]);

function resolveOperationOrigin(
    obj: GeometryOperationObject,
    bbox: { x: number; y: number; width: number; height: number },
    ctx: ResolveContext
) {
    const defaultOrigin = {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
    };

    let origin;
    if ("origin" in obj && obj.origin !== undefined) {
        const resolved = resolveAnchorValue(obj.origin, ctx);
        origin = typeof resolved === "number"
            ? { x: resolved, y: resolved }
            : resolved;
    } else {
        origin = defaultOrigin;
    }

    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
        throw new ResolveError(
            "Operation origin must resolve to finite coordinates",
            "INVALID_VALUE",
            undefined,
            "origin"
        );
    }
    return origin;
}

function assertFiniteOperationTransform(transform: any, id: string): void {
    const values = transform.type === "translate"
        ? [transform.x, transform.y]
        : transform.type === "rotate"
            ? [transform.angle, transform.origin?.x, transform.origin?.y]
            : transform.type === "scale"
                ? [...transform.factor, transform.origin?.x, transform.origin?.y]
                : [transform.origin?.x, transform.origin?.y];
    if (values.some(value => !Number.isFinite(value))) {
        throw new ResolveError(
            `Operation "${id}" contains non-finite transform values`,
            "INVALID_VALUE",
            id,
            "transform"
        );
    }
}

export function resolveGeometryOperationObject(
    id: string,
    obj: GeometryOperationObject,
    ctx: ResolveContext
): ResolvedObject {
    const target = ctx.objects[obj.target];
    if (!target) {
        throw new ResolveError(
            `Operation target "${obj.target}" not found or not yet resolved.`,
            "UNKNOWN_REFERENCE",
            id,
            "target"
        );
    }

    if (obj.type === "reverse" && !REVERSIBLE_TARGET_TYPES.has(target.type)) {
        throw new ResolveError(
            `reverse target "${obj.target}" does not expose a reversible traversal surface`,
            "INVALID_REVERSE_TARGET",
            id,
            "target"
        );
    }

    if (obj.type !== "reverse" && obj.type !== "split" && !GEOMETRY_OPERATION_TARGET_TYPES.has(target.type)) {
        throw new ResolveError(
            `${obj.type} target "${obj.target}" is not a geometry object`,
            "INVALID_OPERATION_TARGET",
            id,
            "target",
        );
    }

    if (obj.type === "split") {
        return resolveSplitOperationObject(id, obj, target, ctx);
    }

    const bbox = calculateBoundingBox({ [obj.target]: target });
    const evalCtx = createEvalContext(ctx);

    let transform: any;
    if (obj.type === "reverse") {
        transform = undefined;
    } else if (obj.type === "translate") {
        transform = {
            type: "translate" as const,
            x: normalizeUnit(evaluateExpression(obj.by[0], evalCtx), ctx.targetUnit),
            y: normalizeUnit(evaluateExpression(obj.by[1], evalCtx), ctx.targetUnit),
        };
    } else if (obj.type === "rotate") {
        transform = {
            type: "rotate" as const,
            angle: evaluateExpression(obj.angle, evalCtx) * (180 / Math.PI),
            origin: resolveOperationOrigin(obj, bbox, ctx),
        };
    } else if (obj.type === "scale") {
    const factor = Array.isArray(obj.factor)
            ? [
                evaluateExpression(obj.factor[0], evalCtx),
                evaluateExpression(obj.factor[1], evalCtx),
            ]
            : [
                evaluateExpression(obj.factor, evalCtx),
                evaluateExpression(obj.factor, evalCtx),
            ];
        if (factor.some(value => !Number.isFinite(value) || value <= 0)) {
            throw new ResolveError(
                `scale operation "${id}" requires finite, positive factors`,
                "INVALID_SCALE_FACTOR",
                id,
                "factor",
            );
        }
        transform = {
            type: "scale" as const,
            factor,
            origin: resolveOperationOrigin(obj, bbox, ctx),
        };
    } else {
        transform = {
            type: "mirror" as const,
            axis: obj.axis,
            origin: resolveOperationOrigin(obj, bbox, ctx),
        };
    }

    if (transform) {
        assertFiniteOperationTransform(transform, id);
    }

    const resolved: ResolvedObject = {
        id,
        type: obj.type,
        target: obj.target,
        children: [obj.target],
        transform: transform ? [transform] : undefined,
        meta: obj.meta,
    } as ResolvedObject;

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx, bbox);
    return resolved;
}

function resolveSplitOperationObject(
    id: string,
    obj: SplitObject,
    target: any,
    ctx: ResolveContext
): ResolvedObject {
    if (!SPLITTABLE_OPERATION_TARGET_TYPES.has(target.type)) {
        throw new ResolveError(
            `split target "${obj.target}" is not a supported open path-like geometry`,
            "INVALID_SPLIT_TARGET",
            id,
            "target"
        );
    }

    const splitPoint = resolveAnchorValue(obj.at, ctx);
    if (
        !splitPoint ||
        typeof splitPoint !== "object" ||
        typeof (splitPoint as any).x !== "number" ||
        typeof (splitPoint as any).y !== "number"
    ) {
        throw new ResolveError(
            `split "${id}" requires "at" to resolve to a point`,
            "INVALID_TYPE",
            id,
            "at"
        );
    }

    let splitResult;
    try {
        splitResult = splitPathLikeByPoint(
            toSplittableTarget(obj.target, target, ctx),
            splitPoint as Point2D,
            {
                tolerance: 1e-4,
                curveSamples: 96,
            }
        );
    } catch (error: any) {
        if (error?.code) {
            throw new ResolveError(error.message.replace(/^[A-Z_]+:\s*/, ""), error.code, id, "at");
        }
        throw new ResolveError(
            `split "${id}" failed to resolve deterministically`,
            "SPLIT_RESOLUTION_FAILED",
            id,
            "at"
        );
    }

    const firstChildId = `${id}[0]`;
    const lastChildId = `${id}[1]`;
    const firstChild = {
        ...splitResult.first,
        id: firstChildId,
        meta: obj.meta,
    };
    const lastChild = {
        ...splitResult.last,
        id: lastChildId,
        meta: obj.meta,
    };

    ctx.objects[firstChildId] = firstChild;
    ctx.objects[lastChildId] = lastChild;

    if (obj.pick === "first" || obj.pick === "last") {
        const picked = obj.pick === "first" ? firstChild : lastChild;
        const bbox = calculateBoundingBox({ [picked.id]: picked });
        picked.anchors = resolveCustomAnchors(obj, picked as any, ctx, bbox);
        return picked as ResolvedObject;
    }

    const collection = {
        id,
        type: "collection" as const,
        children: [firstChildId, lastChildId],
        meta: obj.meta,
    };
    const bbox = calculateBoundingBox({
        [firstChildId]: firstChild,
        [lastChildId]: lastChild,
        [id]: collection,
    });
    return {
        ...collection,
        anchors: resolveCustomAnchors(obj, collection as any, ctx, bbox),
    } as ResolvedObject;
}

function toSplittableTarget(targetId: string, source: any, ctx: ResolveContext): SplitSupportedTarget {
    if (source.type === "reverse") {
        const target = ctx.objects[source.target];
        const reversedSegments = toSplittableSegments(source.target, target, ctx)
            .slice()
            .reverse()
            .map(reverseResolvedSegment);
        return {
            id: targetId,
            type: "path",
            segments: reversedSegments,
            closed: false,
        };
    }

    if (source.type === "translate" || source.type === "rotate" || source.type === "scale" || source.type === "mirror") {
        const target = ctx.objects[source.target];
        const targetSegments = toSplittableSegments(source.target, target, ctx);
        const transformedSegments =
            source.transform && source.transform.length > 0
                ? applyOperationTransformToSegments(targetSegments, source.transform[0], targetId)
                : targetSegments;
        return {
            id: targetId,
            type: "path",
            segments: transformedSegments,
            closed: false,
        };
    }

    if (source.type === "line" || source.type === "arc" || source.type === "quadratic" || source.type === "cubic") {
        return source as SplitSupportedTarget;
    }

    if (source.type === "path") {
        return source as SplitSupportedTarget;
    }

    throw new ResolveError(
        `split target "${targetId}" is not a supported open path-like geometry`,
        "INVALID_SPLIT_TARGET",
        targetId
    );
}

function toSplittableSegments(targetId: string, source: any, ctx: ResolveContext): PathResolvedSegment[] {
    if (!source) {
        throw new ResolveError(`Unknown split target "${targetId}"`, "INVALID_SPLIT_TARGET", targetId);
    }

    // Lower operation chains from the innermost path outward so a split can
    // target a transformed operation whose target is itself transformed.
    if (source.type === "reverse") {
        const target = ctx.objects[source.target];
        return toSplittableSegments(source.target, target, ctx)
            .slice()
            .reverse()
            .map(reverseResolvedSegment);
    }
    if (source.type === "translate" || source.type === "rotate" || source.type === "scale" || source.type === "mirror") {
        const target = ctx.objects[source.target];
        const targetSegments = toSplittableSegments(source.target, target, ctx);
        return source.transform && source.transform.length > 0
            ? applyOperationTransformToSegments(targetSegments, source.transform[0], targetId)
            : targetSegments;
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
    if (source.type === "path") {
        if (source.closed === true) {
            throw new ResolveError(
                `split target "${targetId}" cannot be a closed path in the active boundary`,
                "INVALID_SPLIT_TARGET",
                targetId
            );
        }
        if (Array.isArray(source.segments) && source.segments.length > 0) {
            return source.segments.map((segment: PathResolvedSegment) => ({ ...segment }));
        }
        if (Array.isArray(source.points) && source.points.length > 1) {
            const segments: PathResolvedSegment[] = [];
            for (let i = 0; i < source.points.length - 1; i++) {
                segments.push({
                    type: "line",
                    x1: source.points[i].x,
                    y1: source.points[i].y,
                    x2: source.points[i + 1].x,
                    y2: source.points[i + 1].y,
                });
            }
            return segments;
        }
    }

    throw new ResolveError(
        `split target "${targetId}" is not a valid open path-like object`,
        "INVALID_SPLIT_TARGET",
        targetId
    );
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

function applyOperationTransformToArcSegment(segment: Extract<PathResolvedSegment, { type: "arc" }>, transform: any, targetId: string): PathResolvedSegment {
    const start = applyTransformPipeline({ x: segment.x1, y: segment.y1 }, [transform] as any);
    const end = applyTransformPipeline({ x: segment.x2, y: segment.y2 }, [transform] as any);
    const center = applyTransformPipeline({ x: segment.cx, y: segment.cy }, [transform] as any);
    const through = segment.xt !== undefined && segment.yt !== undefined
        ? applyTransformPipeline({ x: segment.xt, y: segment.yt }, [transform] as any)
        : undefined;

    if (transform.type === "translate" || transform.type === "rotate") {
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
                `split target "${targetId}" uses a non-uniformly scaled arc that cannot be lowered safely`,
                "INVALID_SPLIT_TARGET",
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

    throw new ResolveError(`Unsupported transform for split target "${targetId}"`, "INVALID_SPLIT_TARGET", targetId);
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
