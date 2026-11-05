import type { EvalContext, TypedValue } from "../evaluator";
import type { ResolveContext } from "./types";
import { getAnchorValue } from "./anchors";
import { CoreError } from "../errors";

export function wrapTypedValue(val: any): TypedValue {
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

/**
 * Creates a standard EvalContext with dynamic identifier resolution.
 */
export function createEvalContext(ctx: ResolveContext): EvalContext {
    const objectPath = ctx.currentObjectId ? `objects.${ctx.currentObjectId}` : undefined;
    const collectionError = (message: string): CoreError => new CoreError(
        message,
        "INVALID_COLLECTION_ACCESS",
        { phase: "runtime", objectId: ctx.currentObjectId, path: objectPath },
    );
    const collectionArgumentError = (message: string): CoreError => new CoreError(
        message,
        "TYPE_MISMATCH",
        { phase: "resolve", objectId: ctx.currentObjectId, path: objectPath },
    );

    return {
        scalars: ctx.scalars,
        targetUnit: ctx.targetUnit,
        objects: ctx.objects,
        parentMap: ctx.parentMap,
        resolveIdentifier: (name: string) => {
            if (ctx.scalars[name] !== undefined) return ctx.scalars[name];
            return undefined;
        },
        get: (name: string) => {
            if (ctx.scalars[name] !== undefined) {
                return wrapTypedValue(ctx.scalars[name]);
            }
            if (ctx.objects && ctx.objects[name] !== undefined) {
                return { type: "object", value: ctx.objects[name] };
            }
            return undefined;
        },
        getMember: (obj: TypedValue, member: string) => {
            const val = obj.value;
            if (obj.type === "frame2d") {
                if (val && typeof val === "object" && member in val) {
                    return wrapTypedValue(val[member]);
                }
                return undefined;
            }
            if (val && typeof val === "object" && val.type !== undefined) {
                // If member is holes, bypass anchor lookup and return directly
                if (member === "holes" && val.holes !== undefined) {
                    return wrapTypedValue(val.holes.map((h: any) => ({ ...h, type: "path", closed: true })));
                }
                if (val.type === "component") {
                    if (val.anchors && val.anchors[member] !== undefined) {
                        return wrapTypedValue(val.anchors[member]);
                    }
                    if (val.hasExports) {
                        throw new CoreError(
                            `Component does not export anchor '${member}'`,
                            "COMPONENT_EXPORT_NOT_FOUND",
                            {
                                phase: "resolve",
                                objectId: ctx.currentObjectId,
                                path: `${objectPath ?? `objects.${val.id}`}.${member}`,
                            },
                        );
                    }
                    if (val.children && val.children.includes(`${val.id}.${member}`)) {
                        const childId = `${val.id}.${member}`;
                        const childObj = ctx.objects[childId];
                        if (childObj) {
                            return wrapTypedValue(childObj);
                        }
                    }
                    return undefined;
                }
                try {
                    const anchorVal = getAnchorValue(val, member, ctx);
                    if (anchorVal !== undefined) {
                        return wrapTypedValue(anchorVal);
                    }
                } catch (e) {
                    // Fall through to generic object field check
                }
            }
            if (val && typeof val === "object" && member in val) {
                return wrapTypedValue(val[member]);
            }
            return undefined;
        },
        getIndex: (arr: TypedValue, index: number | number[]) => {
            const val = arr.value;
            if (arr.type === "object" && val && val.type === "collection") {
                if (Array.isArray(index)) {
                    const childId = `${val.id}[${index[0]},${index[1]}]`;
                    const childObj = ctx.objects[childId];
                    if (!childObj) {
                        throw collectionError(`Grid index [${index[0]}, ${index[1]}] out of bounds on collection ${val.id}`);
                    }
                    return wrapTypedValue(childObj);
                } else {
                    if (Array.isArray(val.children)) {
                        const childId = val.children[index];
                        if (childId === undefined) {
                            throw collectionError(`Index ${index} out of bounds on collection ${val.id}`);
                        }
                        const childObj = ctx.objects[childId];
                        if (!childObj) {
                            throw collectionError(`Resolved object ${childId} not found`);
                        }
                        return wrapTypedValue(childObj);
                    }
                }
            }
            if (Array.isArray(val)) {
                const item = val[index as number];
                if (item !== undefined) {
                    if (item && typeof item === "object" && !item.type && item.segments) {
                        return wrapTypedValue({ ...item, type: "path", closed: true });
                    }
                    return wrapTypedValue(item);
                }
            }
            return undefined;
        },
        callFunction: (name: string, args: TypedValue[]) => {
            if (name === "count") {
                const arg = args[0];
                if (!arg) throw collectionArgumentError("count() requires exactly one argument");
                if (arg.type === "array" && Array.isArray(arg.value)) {
                    return wrapTypedValue(arg.value.length);
                }
                const val = arg.value;
                if (arg.type === "object" && val && val.type === "collection") {
                    if (Array.isArray(val.children)) {
                        return wrapTypedValue(val.children.length);
                    }
                }
                if (Array.isArray(val)) {
                    return wrapTypedValue(val.length);
                }
                throw collectionArgumentError(`count() argument must be an array or collection, got type "${arg.type}"`);
            }
            
            if (name === "first") {
                const arg = args[0];
                if (!arg) throw collectionArgumentError("first() requires exactly one argument");
                if (arg.type === "array" && Array.isArray(arg.value)) {
                    if (arg.value.length === 0) {
                        throw collectionError("first() called on empty array");
                    }
                    return wrapTypedValue(arg.value[0]);
                }
                const val = arg.value;
                if (arg.type === "object" && val && val.type === "collection") {
                    if (Array.isArray(val.children)) {
                        if (val.children.length === 0) {
                            throw collectionError("first() called on empty collection");
                        }
                        const childId = val.children[0];
                        const childObj = ctx.objects[childId];
                        if (!childObj) {
                            throw collectionError(`Resolved object ${childId} not found`);
                        }
                        return wrapTypedValue(childObj);
                    }
                }
                if (Array.isArray(val)) {
                    if (val.length === 0) {
                        throw collectionError("first() called on empty list");
                    }
                    return wrapTypedValue(val[0]);
                }
                throw collectionArgumentError(`first() argument must be an array or collection, got type "${arg.type}"`);
            }
            
            if (name === "last") {
                const arg = args[0];
                if (!arg) throw collectionArgumentError("last() requires exactly one argument");
                if (arg.type === "array" && Array.isArray(arg.value)) {
                    if (arg.value.length === 0) {
                        throw collectionError("last() called on empty array");
                    }
                    return wrapTypedValue(arg.value[arg.value.length - 1]);
                }
                const val = arg.value;
                if (arg.type === "object" && val && val.type === "collection") {
                    if (Array.isArray(val.children)) {
                        if (val.children.length === 0) {
                            throw collectionError("last() called on empty collection");
                        }
                        const childId = val.children[val.children.length - 1];
                        const childObj = ctx.objects[childId];
                        if (!childObj) {
                            throw collectionError(`Resolved object ${childId} not found`);
                        }
                        return wrapTypedValue(childObj);
                    }
                }
                if (Array.isArray(val)) {
                    if (val.length === 0) {
                        throw collectionError("last() called on empty list");
                    }
                    return wrapTypedValue(val[val.length - 1]);
                }
                throw collectionArgumentError(`last() argument must be an array or collection, got type "${arg.type}"`);
            }
            
            return undefined;
        }
    };
}
