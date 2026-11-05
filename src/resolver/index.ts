import type { RelGeoDocument, ResolvedScene, RelGeoMode, ConstraintViolation, ResolvedSheet, ResolvedView, ResolvedSheetView } from "../types";
import { defaultTextMetricsProvider } from "../types";
import { normalizeUnit, convertFromPx, convertToPx } from "../units";
import { sortObjects, sortUnified } from "../graph";
import type { ResolveOptions, ResolveContext } from "./types";
import { resolveValues, evaluateSingleDerived } from "./values";
import { resolveObject } from "./objects";
import { processConstraints } from "./constraints";
import {
    calculateBoundingBox,
} from "./geometry-utils";
import { Validator } from "../validator";
import { parseRelGeo } from "../parser";
import { evaluateExpression } from "../evaluator";
import { createEvalContext } from "./eval-context";
import { hasStructuredDiagnostic, normalizeResolveError } from "../errors";

export type { ResolveOptions, ResolveContext } from "./types";
export { ResolveError } from "./types";
export { resolveValues } from "./values";
export { parseForEditor } from "../parser";
export { calculateBoundingBox } from "./geometry-utils";

/**
 * High-level helper to parse, validate, and resolve geometry in one go.
 * Best for production/CLI usage.
 */
export function compileRelGeo(
    yaml: string,
    options: ResolveOptions = {}
): ResolvedScene {
    const doc = parseRelGeo(yaml, { mode: "compile" });
    return resolveGeometry(doc, { ...options, mode: "compile" });
}

export function resolveGeometry(
    doc: RelGeoDocument,
    options: ResolveOptions = {}
): ResolvedScene {
    try {
        return resolveGeometryInternal(doc, options);
    } catch (error) {
        // Validation and other structured boundary errors already carry their
        // normative phase/code/path payload. Re-wrapping them as ResolveError
        // would misclassify validate diagnostics as resolve diagnostics.
        if (hasStructuredDiagnostic(error)) {
            throw error;
        }
        throw normalizeResolveError(error);
    }
}

function resolveGeometryInternal(
    doc: RelGeoDocument,
    options: ResolveOptions = {}
): ResolvedScene {
    const mode: RelGeoMode = options.mode || "validate";
    const docObjects = doc.objects || {};
    
    // 1. Mandatory Validation for non-editor modes
    if (mode === "compile" || mode === "validate") {
        new Validator(doc, mode).validate();
    }

    const targetUnit = options.targetUnit || doc.scene?.unit || "px";
    const scalars = resolveValues(doc, options);
    const objects: Record<string, any> = {};

    // Build parent map for coordinate space rules
    const parentMap = new Map<string, string>();
    for (const [id, obj] of Object.entries(docObjects)) {
        if (obj.type === "group" && Array.isArray(obj.children)) {
            for (const childId of obj.children) {
                parentMap.set(childId, id);
            }
        } else if (obj.type === "clone") {
            const source = docObjects[obj.of];
            if (source) {
                const children = source.type === "group" ? (source as any).children : [obj.of];
                if (Array.isArray(children)) {
                    for (const childId of children) {
                        parentMap.set(childId, id);
                    }
                }
            }
        } else if (
            (obj.type === "translate" ||
                obj.type === "rotate" ||
                obj.type === "scale" ||
                obj.type === "mirror" ||
                obj.type === "reverse") &&
            (obj as any).target
        ) {
            parentMap.set((obj as any).target, id);
        }
    }

    const ctx: ResolveContext = {
        scalars,
        objects,
        targetUnit,
        parentMap,
        mode,
        textMetrics: options.textMetrics || defaultTextMetricsProvider,
        doc,
    };

    // 2. Resolve Objects + Derived in unified topological order
    const hasDerived = !!(doc.derived && Object.keys(doc.derived).length > 0);
    const resolvedMap: Record<string, any> = {};

    if (hasDerived) {
        // Unified toposort: objects and derived values interleaved
        const unifiedOrder = sortUnified(docObjects, doc.derived || {}, { ...doc, objects: docObjects });

        for (const node of unifiedOrder) {
            if (node.kind === "object") {
                const obj = docObjects[node.id];
                let resolved;
                try {
                    resolved = resolveObject(node.id, obj, {
                        ...ctx,
                        objects: resolvedMap,
                        currentObjectId: node.id
                    });
                } catch (error) {
                    if (hasStructuredDiagnostic(error)) throw error;
                    throw normalizeResolveError(error, node.id, `objects.${node.id}`);
                }
                if (resolved !== undefined) {
                    resolvedMap[node.id] = resolved;
                }
            } else {
                // derived node — evaluate with full context (including already-resolved objects)
                const fullCtx: ResolveContext = { ...ctx, objects: resolvedMap };
                const evalCtx = createEvalContext(fullCtx);
                const result = evaluateSingleDerived(node.id, doc.derived![node.id], evalCtx);
                scalars[node.id] = result;
            }
        }
    } else {
        // Fast path: no derived, just sort objects as before
        const sortedIds = sortObjects(docObjects, { ...doc, objects: docObjects });
        for (const id of sortedIds) {
            const obj = docObjects[id];
            let resolved;
            try {
                resolved = resolveObject(id, obj, {
                    ...ctx,
                    objects: resolvedMap,
                    currentObjectId: id
                });
            } catch (error) {
                if (hasStructuredDiagnostic(error)) throw error;
                throw normalizeResolveError(error, id, `objects.${id}`);
            }
            if (resolved !== undefined) {
                resolvedMap[id] = resolved;
            }
        }
    }

    // 3. Build final objects in Declaration Order (for Z-order consistency)
    for (const id in docObjects) {
        if (resolvedMap[id]) {
            objects[id] = resolvedMap[id];
        }
    }
    // Also include any generated repeat/divide child elements
    for (const id in resolvedMap) {
        if (!objects[id]) {
            objects[id] = resolvedMap[id];
        }
    }

    // 4. Process Explicit Constraints (Post-Resolution Alignment)
    const constraintCtx = {
        ...ctx,
        objects: resolvedMap,
    };

    let violations: ConstraintViolation[] = [];
    if (doc.constraints) {
        violations = processConstraints(doc.constraints, constraintCtx);
    }

function parseScale(scale: string | number | undefined): number {
    if (scale === undefined) return 1;
    if (typeof scale === "number") return scale;
    if (typeof scale === "string") {
        const parts = scale.split(":");
        if (parts.length === 2) {
            const num = parseFloat(parts[0]);
            const den = parseFloat(parts[1]);
            if (!isNaN(num) && !isNaN(den) && den !== 0) {
                return num / den;
            }
        }
        const num = parseFloat(scale);
        if (!isNaN(num)) return num;
    }
    return 1;
}

    // 5. Calculate Bounding Box (Global space)
    const bbox = calculateBoundingBox(objects, parentMap, {
        ignoreRoles: ["construction", "guide", "centerline", "hidden"]
    });
    // 6. Resolve Sheets & Views
    const resolvedViews: Record<string, ResolvedView> = {};
    if (doc.views) {
        for (const [viewId, viewDef] of Object.entries(doc.views)) {
            const targetId = viewDef.target;
            const targetObj = objects[targetId];
            if (!targetObj) continue;

            const viewObjects: Record<string, any> = {};
            const collectSubObjects = (id: string) => {
                const obj = objects[id];
                if (!obj) return;

                const role = obj.meta?.role || "final";
                const allowedRoles = viewDef.filter?.roles;
                if (!allowedRoles || allowedRoles.includes(role)) {
                    viewObjects[id] = obj;
                }

                const shapeObj = objects[id] || docObjects[id];
                const rawObj = docObjects[id] || objects[id];
                if (shapeObj || rawObj) {
                    if ((shapeObj?.type === "group" || shapeObj?.type === "collection" || shapeObj?.type === "clone") && Array.isArray(shapeObj?.children)) {
                        for (const childId of shapeObj.children) {
                            collectSubObjects(childId);
                        }
                    } else if (rawObj?.type === "component") {
                        for (const key of Object.keys(objects)) {
                            if (key.startsWith(`${id}.`)) {
                                collectSubObjects(key);
                            }
                        }
                    } else if (rawObj?.type === "repeat") {
                        for (const key of Object.keys(objects)) {
                            if (key.startsWith(`${id}[`)) {
                                collectSubObjects(key);
                            }
                        }
                    }
                }
            };
            collectSubObjects(targetId);

            const scaleFactor = parseScale(viewDef.scale);
            const viewBbox = calculateBoundingBox(viewObjects, parentMap, {
                ignoreRoles: ["construction", "guide", "centerline", "hidden"]
            });
            const scaledBbox = {
                x: viewBbox.x * scaleFactor,
                y: viewBbox.y * scaleFactor,
                width: viewBbox.width * scaleFactor,
                height: viewBbox.height * scaleFactor,
            };

            resolvedViews[viewId] = {
                id: viewId,
                target: targetId,
                scale: viewDef.scale ?? "1:1",
                scaleFactor,
                objects: viewObjects,
                bbox: scaledBbox,
                meta: viewDef.meta as any,
            };
        }
    }

    const resolvedSheets: Record<string, ResolvedSheet> = {};
    if (doc.sheets) {
        for (const [sheetId, sheetDef] of Object.entries(doc.sheets)) {
            let width = convertFromPx(convertToPx("297mm"), targetUnit); // Default A4 landscape
            let height = convertFromPx(convertToPx("210mm"), targetUnit);
            const size = sheetDef.size;
            const evalCtx = { scalars, targetUnit };
            if (typeof size === "string") {
                const s = size.toUpperCase();
                if (s === "A4") { width = convertFromPx(convertToPx("297mm"), targetUnit); height = convertFromPx(convertToPx("210mm"), targetUnit); }
                else if (s === "A3") { width = convertFromPx(convertToPx("420mm"), targetUnit); height = convertFromPx(convertToPx("297mm"), targetUnit); }
                else if (s === "A2") { width = convertFromPx(convertToPx("594mm"), targetUnit); height = convertFromPx(convertToPx("420mm"), targetUnit); }
                else if (s === "A1") { width = convertFromPx(convertToPx("841mm"), targetUnit); height = convertFromPx(convertToPx("594mm"), targetUnit); }
                else if (s === "A0") { width = convertFromPx(convertToPx("1189mm"), targetUnit); height = convertFromPx(convertToPx("841mm"), targetUnit); }
            } else if (Array.isArray(size) && size.length === 2) {
                width = normalizeUnit(evaluateExpression(size[0], evalCtx), targetUnit);
                height = normalizeUnit(evaluateExpression(size[1], evalCtx), targetUnit);
            }

            if (sheetDef.orientation === "portrait") {
                const temp = width;
                width = height;
                height = temp;
            }

            const viewsPlacement: ResolvedSheetView[] = [];
            if (sheetDef.views) {
                for (const placement of sheetDef.views) {
                    const view = resolvedViews[placement.use];
                    if (!view) continue;

                    let x = 0;
                    let y = 0;
                    if (placement.place) {
                        if (placement.place.topLeft) {
                            x = normalizeUnit(evaluateExpression(placement.place.topLeft[0], evalCtx), targetUnit);
                            y = normalizeUnit(evaluateExpression(placement.place.topLeft[1], evalCtx), targetUnit);
                        } else if (placement.place.center) {
                            const cx = normalizeUnit(evaluateExpression(placement.place.center[0], evalCtx), targetUnit);
                            const cy = normalizeUnit(evaluateExpression(placement.place.center[1], evalCtx), targetUnit);
                            x = cx - view.bbox.width / 2;
                            y = cy - view.bbox.height / 2;
                        }
                    }

                    viewsPlacement.push({
                        use: placement.use,
                        x,
                        y,
                        width: view.bbox.width,
                        height: view.bbox.height,
                    });
                }
            }

            resolvedSheets[sheetId] = {
                id: sheetId,
                size: typeof size === "string" ? size : [width, height],
                width,
                height,
                views: viewsPlacement,
                meta: sheetDef.meta as any,
            };
        }
    }

    const evalCtx = { scalars, targetUnit };

    return {
        unit: targetUnit,
        orientation: doc.scene?.orientation,
        origin: doc.scene?.origin,
        autoSize: doc.scene?.autoSize ?? true,
        padding:
            doc.scene?.padding !== undefined
                ? normalizeUnit(doc.scene.padding, targetUnit)
                : normalizeUnit("20px", targetUnit),
        objects,
        bbox,
        parameters: doc.parameters || {},
        values: scalars,
        meta: doc.meta as any,
        violations,
        sheets: resolvedSheets,
        views: resolvedViews,
    };
}
