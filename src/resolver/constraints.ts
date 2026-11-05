import type { ResolveContext } from "./types";
import {
    resolveAnchorValue,
    isPointLike,
} from "./anchors";
import type { 
    ConstraintObject, 
    ResolvedLine,
    ResolvedCircle,
    ResolvedArc,
    RelGeoError,
    RelGeoErrorCode,
    ConstraintViolation
} from "../types";
import { evaluateExpression } from "../evaluator";
import { createEvalContext } from "./eval-context";
import { normalizeUnit } from "../units";
import { intersectLineCircle, intersectLineArc } from "./intersection";

const EPSILON = 0.001;
type PendingConstraintViolation = Omit<ConstraintViolation, 'severity' | 'origin' | 'expected' | 'actual'>;

function lineLength(line: ResolvedLine): number {
    return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function degenerateRelationViolation(
    type: 'parallel' | 'perpendicular' | 'tangent',
    message: string,
    path: string,
    involvedObjects: string[]
): PendingConstraintViolation {
    return {
        type,
        message,
        deviation: 1,
        path,
        involvedObjects
    };
}

export class ConstraintError extends Error implements RelGeoError {
    public code: RelGeoErrorCode;
    public objectId?: string;
    public path?: string;

    constructor(
        message: string,
        code: RelGeoErrorCode = "CONSTRAINT_VIOLATION",
        objectId?: string,
        path?: string
    ) {
        const fullMessage = `${code}: ${message}`;
        super(fullMessage);
        this.message = fullMessage;
        this.code = code;
        this.objectId = objectId;
        this.path = path;
        this.name = "ConstraintError";
    }
}

export function processConstraints(constraints: ConstraintObject[], ctx: ResolveContext): ConstraintViolation[] {
    const evalCtx = createEvalContext(ctx);
    const violations: PendingConstraintViolation[] = [];

    for (let i = 0; i < constraints.length; i++) {
        const c = constraints[i];
        const path = `constraints[${i}]`;

        if ("align" in c) {
            const { target, with: withRef, offset: offsetExpr } = c.align;
            
            const targetValue = resolveAnchorValue(target, ctx);
            const withValue = resolveAnchorValue(withRef, ctx);
            const offset = offsetExpr !== undefined 
                ? normalizeUnit(evaluateExpression(offsetExpr, evalCtx), ctx.targetUnit)
                : 0;

            if (isPointLike(targetValue) && isPointLike(withValue)) {
                const dx = withValue.x - targetValue.x;
                const dy = withValue.y - targetValue.y;
                const deviation = Math.sqrt(dx * dx + dy * dy);
                
                if (deviation > EPSILON) {
                    violations.push({
                        type: 'align',
                        message: `Points are not aligned. Distance: ${deviation.toFixed(4)}`,
                        deviation,
                        path,
                        involvedObjects: [],
                        visualHelper: {
                            x1: targetValue.x,
                            y1: targetValue.y,
                            x2: withValue.x,
                            y2: withValue.y
                        }
                    });
                }
            } else if (typeof targetValue === "number" && typeof withValue === "number") {
                const deviation = Math.abs(targetValue - (withValue + offset));
                if (deviation > EPSILON) {
                    violations.push({
                        type: 'align',
                        message: `Scalar values are not aligned. Difference: ${deviation.toFixed(4)}`,
                        deviation,
                        path,
                        involvedObjects: []
                    });
                }
            }
        } else if ("equal" in c) {
            const rawEqualValues = Array.isArray(c.equal)
                ? c.equal
                : [c.equal.left, c.equal.right];
            const values = rawEqualValues.map(v => normalizeUnit(evaluateExpression(v, evalCtx), ctx.targetUnit));
            if (values.length > 1) {
                const first = values[0];
                for (let j = 1; j < values.length; j++) {
                    const deviation = Math.abs(values[j] - first);
                    if (deviation > EPSILON) {
                        violations.push({
                            type: 'equal',
                            message: `Values are not equal: ${values[j]} vs ${first}. Difference: ${deviation.toFixed(4)}`,
                            deviation,
                            path,
                            involvedObjects: []
                        });
                    }
                }
            }
        } else if ("parallel" in c) {
            const [id1, id2] = c.parallel;
            const l1 = ctx.objects[id1] as ResolvedLine;
            const l2 = ctx.objects[id2] as ResolvedLine;
            
            if (l1 && l2 && l1.type === "line" && l2.type === "line") {
                const length1 = lineLength(l1);
                const length2 = lineLength(l2);
                if (!Number.isFinite(length1) || !Number.isFinite(length2) || length1 <= EPSILON || length2 <= EPSILON) {
                    violations.push(degenerateRelationViolation(
                        'parallel',
                        `Lines ${id1} and ${id2} must both have non-zero length to establish parallelism.`,
                        path,
                        [id1, id2]
                    ));
                    continue;
                }
                const angle1 = Math.atan2(l1.y2 - l1.y1, l1.x2 - l1.x1);
                const angle2 = Math.atan2(l2.y2 - l2.y1, l2.x2 - l2.x1);
                const rawDiff = Math.abs((angle1 - angle2) % Math.PI);
                const deviation = Math.min(rawDiff, Math.abs(rawDiff - Math.PI));
                
                if (deviation > EPSILON) {
                    violations.push({
                        type: 'parallel',
                        message: `Lines ${id1} and ${id2} are not parallel. Angular deviation: ${deviation.toFixed(4)} rad`,
                        deviation,
                        path,
                        involvedObjects: [id1, id2]
                    });
                }
            }
        } else if ("perpendicular" in c) {
            const [id1, id2] = c.perpendicular;
            const l1 = ctx.objects[id1] as ResolvedLine;
            const l2 = ctx.objects[id2] as ResolvedLine;
            
            if (l1 && l2 && l1.type === "line" && l2.type === "line") {
                const length1 = lineLength(l1);
                const length2 = lineLength(l2);
                if (!Number.isFinite(length1) || !Number.isFinite(length2) || length1 <= EPSILON || length2 <= EPSILON) {
                    violations.push(degenerateRelationViolation(
                        'perpendicular',
                        `Lines ${id1} and ${id2} must both have non-zero length to establish perpendicularity.`,
                        path,
                        [id1, id2]
                    ));
                    continue;
                }
                const angle1 = Math.atan2(l1.y2 - l1.y1, l1.x2 - l1.x1);
                const angle2 = Math.atan2(l2.y2 - l2.y1, l2.x2 - l2.x1);
                const rawDiff = Math.abs((angle1 - angle2) % Math.PI);
                const deviation = Math.abs(rawDiff - Math.PI / 2);
                
                if (deviation > EPSILON) {
                    violations.push({
                        type: 'perpendicular',
                        message: `Lines ${id1} and ${id2} are not perpendicular. Angular deviation: ${deviation.toFixed(4)} rad`,
                        deviation,
                        path,
                        involvedObjects: [id1, id2]
                    });
                }
            }
        } else if ("tangent" in c) {
            const [ref1, ref2] = c.tangent;
            const obj1 = ctx.objects[ref1];
            const obj2 = ctx.objects[ref2];

            const line = obj1?.type === "line" ? (obj1 as ResolvedLine) : obj2?.type === "line" ? (obj2 as ResolvedLine) : null;
            const target =
                obj1?.type === "circle" || obj1?.type === "arc"
                    ? obj1
                    : obj2?.type === "circle" || obj2?.type === "arc"
                    ? obj2
                    : null;

            if (line && target) {
                const lineMagnitude = lineLength(line);
                const targetRadius = target.type === "circle" || target.type === "arc" ? target.radius : 0;
                if (!Number.isFinite(lineMagnitude) || lineMagnitude <= EPSILON || !Number.isFinite(targetRadius) || targetRadius <= EPSILON) {
                    violations.push(degenerateRelationViolation(
                        'tangent',
                        `Objects ${ref1} and ${ref2} must have non-degenerate geometry to establish tangency.`,
                        path,
                        [ref1, ref2]
                    ));
                    continue;
                }
                const intersections =
                    target.type === "circle"
                        ? intersectLineCircle(line, target as ResolvedCircle)
                        : intersectLineArc(line, target as ResolvedArc);

                if (intersections.length !== 1) {
                    violations.push({
                        type: 'tangent',
                        message: `Objects ${ref1} and ${ref2} are not tangent. Found ${intersections.length} intersection(s).`,
                        deviation: Math.abs(intersections.length - 1),
                        path,
                        involvedObjects: [ref1, ref2]
                    });
                }
            }
        }
    }

    return violations.map((violation) => ({
        ...violation,
        severity: 'error' as const,
        origin: 'constraint' as const,
        expected: { deviation: 0, tolerance: EPSILON },
        actual: { deviation: violation.deviation },
    }));
}
