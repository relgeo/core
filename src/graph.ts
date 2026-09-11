import { KNOWN_FUNCTIONS } from "./constants";
import type { 
  CircleObject, EllipseObject, GroupObject, LineObject, PlaceSpec, PointObject, RectObject, 
  RelGeoObject, ArcObject, CubicObject, QuadraticObject, PathObject, PolygonObject,
  TextObject, CloneObject, PlaceableObject, RepeatObject, DivideObject, CollectionObject,
  RelGeoDocument, OnSpec, TranslateObject, RotateObject, ScaleObject, MirrorObject
  , ReverseObject
} from "./types";
import { ResolveError } from "./resolver/types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractObjectRefs(value: unknown, objectIds: Set<string>): string[] {
  if (Array.isArray(value)) {
    const refs: string[] = [];
    for (const item of value) {
      refs.push(...extractObjectRefs(item, objectIds));
    }
    return [...new Set(refs)];
  }

  if (typeof value !== "string") return [];

  // Strip string literals to avoid false positives (e.g., 'A' in format('A'))
  const cleanedValue = value.replace(/'[^']*'|"[^"]*"/g, "");

  const refs: string[] = [];

  for (const objectId of objectIds) {
    const pattern = new RegExp(`\\b${escapeRegExp(objectId)}\\b`);

    if (pattern.test(cleanedValue) && !KNOWN_FUNCTIONS.has(objectId)) {
      refs.push(objectId);
    }
  }

  return refs;
}

function isDescendant(childId: string, potentialParentId: string, parentMap: Map<string, string>): boolean {
  let p = parentMap.get(childId);
  while (p) {
    if (p === potentialParentId) return true;
    p = parentMap.get(p);
  }
  return false;
}

function collectFromPlace(
  place: PlaceSpec | undefined,
  addRef: (value: unknown) => void
) {
  if (!place) return;

  for (const value of Object.values(place)) {
    addRef(value);
  }
}

function collectFromOn(
  on: OnSpec | undefined,
  addRef: (value: unknown) => void
) {
  if (!on) return;

  if (on.point) {
    addRef(on.point.at);
    addRef(on.point.anchor);
  }
  if (on.path) {
    addRef(on.path.path);
    addRef(on.path.t);
    addRef(on.path.anchor);
  }
  if (on.frame) {
    addRef(on.frame.path);
    addRef(on.frame.t);
    addRef(on.frame.anchor);
  }
}

function addPointDependencies(
  obj: PointObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.at);
  addRef(obj.from);

  collectFromOn(obj.on, addRef);

  if (obj.move) {
    addRef(obj.move.angle);
    addRef(obj.move.distance);
    addRef(obj.move.left);
    addRef(obj.move.right);
    addRef(obj.move.up);
    addRef(obj.move.down);
  }
}

function addLineDependencies(
  obj: LineObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.from);
  addRef(obj.to);
  addRef(obj.length);
  addRef(obj.direction);
  
  if (obj.tangent) {
    addRef(obj.tangent.from);
    addRef(obj.tangent.to);
  }
}

function addArcDependencies(
  obj: ArcObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.from);
  addRef(obj.through);
  addRef(obj.to);
  addRef(obj.center);
  addRef(obj.radius);
  addRef(obj.startAngle);
  addRef(obj.endAngle);
}

function addCurveDependencies(
  obj: CubicObject | QuadraticObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.from);
  addRef(obj.to);
  if (obj.type === "quadratic") {
    addRef(obj.cp);
  } else if (obj.type === "cubic") {
    addRef(obj.cp1);
    addRef(obj.cp2);
  }
}

function addClosedShapeHolesDependencies(
  obj: any,
  addRef: (value: unknown) => void
) {
  if (Array.isArray(obj.holes)) {
    for (const hole of obj.holes) {
      if (typeof hole === "string") {
        addRef(hole);
      } else if (hole && typeof hole === "object") {
        if (Array.isArray(hole.segments)) {
          for (const seg of hole.segments) {
            if ("line" in seg) { addRef(seg.line.from); addRef(seg.line.to); }
            if ("arc" in seg) { addRef(seg.arc.through); addRef(seg.arc.to); }
            if ("quadratic" in seg) { addRef(seg.quadratic.cp); addRef(seg.quadratic.to); }
            if ("cubic" in seg) { addRef(seg.cubic.cp1); addRef(seg.cubic.cp2); addRef(seg.cubic.to); }
          }
        } else {
          const keys = Object.keys(hole).filter(k => k !== "place");
          const holeType = hole.type || (keys.length === 1 ? keys[0] : undefined);
          const holeData = hole.type ? hole : (holeType ? hole[holeType] : undefined);
          
          if (holeType === "rect") {
            if (holeData.size) {
              addRef(holeData.size[0]);
              addRef(holeData.size[1]);
            }
          } else if (holeType === "circle") {
            addRef(holeData.center);
            addRef(holeData.radius);
            addRef(holeData.through);
          } else if (holeType === "ellipse") {
            addRef(holeData.center);
            addRef(holeData.rx);
            addRef(holeData.ry);
            if (Array.isArray(holeData.size)) {
              addRef(holeData.size[0]);
              addRef(holeData.size[1]);
            }
            addRef(holeData.rotation);
          } else if (holeType === "polygon") {
            if (Array.isArray(holeData.points)) {
              for (const pt of holeData.points) {
                addRef(pt);
              }
            }
          } else if (holeType === "path") {
            if (Array.isArray(holeData.segments)) {
              for (const seg of holeData.segments) {
                if ("line" in seg) { addRef(seg.line.from); addRef(seg.line.to); }
                if ("arc" in seg) { addRef(seg.arc.through); addRef(seg.arc.to); }
                if ("quadratic" in seg) { addRef(seg.quadratic.cp); addRef(seg.quadratic.to); }
                if ("cubic" in seg) { addRef(seg.cubic.cp1); addRef(seg.cubic.cp2); addRef(seg.cubic.to); }
              }
            }
          } else if (holeType === "clone") {
            addRef(holeData.of);
          } else if (holeType === "segments" && Array.isArray(holeData)) {
            for (const seg of holeData) {
              if ("line" in seg) { addRef(seg.line.from); addRef(seg.line.to); }
              if ("arc" in seg) { addRef(seg.arc.through); addRef(seg.arc.to); }
              if ("quadratic" in seg) { addRef(seg.quadratic.cp); addRef(seg.quadratic.to); }
              if ("cubic" in seg) { addRef(seg.cubic.cp1); addRef(seg.cubic.cp2); addRef(seg.cubic.to); }
            }
          }
          const placeObj = hole.place || holeData?.place;
          if (placeObj) collectFromPlace(placeObj, addRef);
        }
      }
    }
  }
}

function addPathDependencies(
  obj: PathObject | PolygonObject,
  addRef: (value: unknown) => void
) {
  if (Array.isArray(obj.points)) {
    for (const pt of obj.points) {
      addRef(pt);
    }
  }
  
  if (Array.isArray(obj.holes)) {
    addClosedShapeHolesDependencies(obj, addRef);
  }
  
  if (obj.type === "path") {
    if (Array.isArray(obj.join)) {
      for (const ref of obj.join) {
        addRef(ref);
      }
    }
    if (Array.isArray(obj.segments)) {
      for (const seg of obj.segments) {
        if ("line" in seg) { addRef(seg.line.from); addRef(seg.line.to); }
        if ("arc" in seg) { addRef(seg.arc.through); addRef(seg.arc.to); }
        if ("quadratic" in seg) { addRef(seg.quadratic.cp); addRef(seg.quadratic.to); }
        if ("cubic" in seg) { addRef(seg.cubic.cp1); addRef(seg.cubic.cp2); addRef(seg.cubic.to); }
      }
    }

    if (obj.offset) {
      addRef(obj.offset.from);
      addRef(obj.offset.distance);
    }
  }
}

function addRectDependencies(
  obj: RectObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.size?.[0]);
  addRef(obj.size?.[1]);
  collectFromPlace(obj.place, addRef);
  if (Array.isArray(obj.holes)) {
    addClosedShapeHolesDependencies(obj, addRef);
  }
}

function addCircleDependencies(
  obj: CircleObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.center);
  addRef(obj.radius);
  addRef(obj.through);
  collectFromPlace(obj.place, addRef);
  if (Array.isArray(obj.holes)) {
    addClosedShapeHolesDependencies(obj, addRef);
  }
}

function addEllipseDependencies(
  obj: EllipseObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.center);
  addRef(obj.rx);
  addRef(obj.ry);
  if (Array.isArray(obj.size)) {
    addRef(obj.size[0]);
    addRef(obj.size[1]);
  }
  addRef(obj.rotation);
  if (Array.isArray(obj.holes)) {
    addClosedShapeHolesDependencies(obj, addRef);
  }
}

function addGroupDependencies(
  obj: GroupObject,
  addRef: (value: unknown) => void
) {
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      addRef(child);
    }
  }

  if (obj.transform) {
    addTransformDependencies(obj.transform, addRef);
  }

  collectFromPlace(obj.place, addRef);
}

function addDeepDeps(obj: any, addRef: (value: unknown) => void) {
  if (!obj) return;
  if (typeof obj !== "object") {
    addRef(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      addDeepDeps(item, addRef);
    }
    return;
  }
  for (const val of Object.values(obj)) {
    addDeepDeps(val, addRef);
  }
}

function addRepeatDependencies(
  obj: RepeatObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.count);
  addRef(obj.each);
  if (obj.grid) {
    addRef(obj.grid.rows);
    addRef(obj.grid.cols);
    if (obj.grid.gap) {
      if (Array.isArray(obj.grid.gap)) {
        addRef(obj.grid.gap[0]);
        addRef(obj.grid.gap[1]);
      } else {
        addRef(obj.grid.gap);
      }
    }
  }
  if (obj.polar) {
    addRef(obj.polar.count);
    addRef(obj.polar.center);
    addRef(obj.polar.radius);
  }
  if (obj.along) {
    addRef(obj.along.target);
    addRef(obj.along.count);
    addRef(obj.along.distance);
    addRef(obj.along.startOffset);
    addRef(obj.along.endOffset);
  }
  if (obj.item) {
    addDeepDeps(obj.item, addRef);
  }
}

function addDivideDependencies(
  obj: DivideObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.target);
  addRef(obj.count);
}

function addOperationObjectDependencies(
  obj: TranslateObject | RotateObject | ScaleObject | MirrorObject | ReverseObject,
  addRef: (value: unknown) => void
) {
  addRef(obj.target);
  if (obj.type === "reverse") {
    return;
  }
  if (obj.type === "translate") {
    addRef(obj.by[0]);
    addRef(obj.by[1]);
    return;
  }
  if (obj.type === "rotate") {
    addRef(obj.angle);
    addRef(obj.origin);
    return;
  }
  if (obj.type === "scale") {
    if (Array.isArray(obj.factor)) {
      addRef(obj.factor[0]);
      addRef(obj.factor[1]);
    } else {
      addRef(obj.factor);
    }
    addRef(obj.origin);
    return;
  }
  addRef(obj.axis);
  addRef(obj.origin);
}

function addComponentDependencies(
  obj: any,
  addRef: (value: unknown) => void,
  doc: RelGeoDocument | undefined,
  objectIds: Set<string>
) {
  addRef(obj.use);
  if (obj.params) {
    for (const val of Object.values(obj.params)) {
      addRef(val);
    }
  }
  collectFromPlace(obj.place, addRef);
  if (obj.transform) {
    addTransformDependencies(obj.transform, addRef);
  }

  const compDef = doc?.components?.[obj.use];
  if (compDef) {
    const localParams = new Set(Object.keys(compDef.parameters || {}));
    const localObjects = new Set(Object.keys(compDef.objects || {}));

    const addLocalRef = (val: unknown) => {
      if (typeof val === "string") {
        const refs = extractObjectRefs(val, objectIds);
        for (const ref of refs) {
          if (!localParams.has(ref) && !localObjects.has(ref)) {
            addRef(ref);
          }
        }
      }
    };

    for (const innerObj of Object.values(compDef.objects || {})) {
      const innerDeps = getObjectDependencies("dummy", innerObj as RelGeoObject, objectIds, undefined, doc);
      for (const dep of innerDeps) {
        if (!localParams.has(dep) && !localObjects.has(dep)) {
          addRef(dep);
        }
      }
    }

    if (compDef.exports) {
      for (const val of Object.values(compDef.exports)) {
        addLocalRef(val);
      }
    }
  }
}

export function getObjectDependencies(
  id: string,
  obj: RelGeoObject,
  objectIds: Set<string>,
  parentMap?: Map<string, string>,
  doc?: RelGeoDocument
): string[] {
  const deps = new Set<string>();

  const addRef = (value: unknown) => {
    for (const refId of extractObjectRefs(value, objectIds)) {
      if (refId !== id) {
        deps.add(refId);
        // Also depend on parents of refId to handle transformed anchor access
        if (parentMap) {
          let parent = parentMap.get(refId);
          while (parent) {
            // Only depend on the parent group if we are NOT inside it ourselves.
            // This prevents the G -> Q -> G cycle when Q references P inside the same group G.
            if (parent !== id && !isDescendant(id, parent, parentMap)) {
              deps.add(parent);
            }
            parent = parentMap.get(parent);
          }
        }
      }
    }
  };

  switch (obj.type) {
    case "point":
      addPointDependencies(obj, addRef);
      break;

    case "line":
      addLineDependencies(obj, addRef);
      break;

    case "rect":
      addRectDependencies(obj, addRef);
      break;

    case "circle":
      addCircleDependencies(obj, addRef);
      break;

    case "ellipse":
      addEllipseDependencies(obj, addRef);
      collectFromPlace((obj as EllipseObject).place, addRef);
      if ((obj as EllipseObject).transform) {
        addTransformDependencies((obj as EllipseObject).transform, addRef);
      }
      break;

    case "group":
      addGroupDependencies(obj as GroupObject, addRef);
      break;

    case "text":
      addRef((obj as TextObject).at);
      const content = (obj as TextObject).content;
      if (typeof content === "string") {
        const matches = content.matchAll(/\{([^{}]+)\}/g);
        for (const m of matches) {
          addRef(m[1].trim());
        }
      } else {
        addRef(content);
      }
      collectFromPlace((obj as TextObject).place, addRef);
      break;

    case "arc":
      addArcDependencies(obj, addRef);
      collectFromPlace((obj as ArcObject).place, addRef);
      if ((obj as ArcObject).transform) {
        addTransformDependencies((obj as ArcObject).transform, addRef);
      }
      break;

    case "cubic":
    case "quadratic":
      addCurveDependencies(obj, addRef);
      collectFromPlace((obj as PlaceableObject).place, addRef);
      if ((obj as PlaceableObject).transform) {
        addTransformDependencies((obj as PlaceableObject).transform, addRef);
      }
      break;

    case "path":
    case "polygon":
      addPathDependencies(obj, addRef);
      collectFromPlace((obj as PlaceableObject).place, addRef);
      if ((obj as PlaceableObject).transform) {
        addTransformDependencies((obj as PlaceableObject).transform, addRef);
      }
      break;

    case "clone":
      addRef((obj as CloneObject).of);
      collectFromPlace((obj as CloneObject).place, addRef);
      if ((obj as CloneObject).transform) {
        addTransformDependencies((obj as CloneObject).transform, addRef);
      }
      break;

    case "translate":
    case "rotate":
    case "scale":
    case "mirror":
    case "reverse":
      addOperationObjectDependencies(obj as TranslateObject | RotateObject | ScaleObject | MirrorObject | ReverseObject, addRef);
      break;

    case "repeat":
      addRepeatDependencies(obj as RepeatObject, addRef);
      break;

    case "divide":
      addDivideDependencies(obj as DivideObject, addRef);
      break;

    case "collection":
      if (Array.isArray((obj as CollectionObject).children)) {
        for (const child of (obj as CollectionObject).children) {
          addRef(child);
        }
      }
      break;

    case "component":
      addComponentDependencies(obj, addRef, doc, objectIds);
      break;

    case "dimension": {
      const dim = obj as any;
      addRef(dim.from);
      addRef(dim.to);
      addRef(dim.offset);
      addRef(dim.target);
      if (Array.isArray(dim.between)) {
        for (const b of dim.between) {
          addRef(b);
        }
      }
      if (typeof dim.text === "string") {
        const matches = dim.text.matchAll(/\{([^{}]+)\}/g);
        for (const m of matches) {
          addRef(m[1].trim());
        }
      }
      break;
    }

    case "annotation": {
      const ann = obj as any;
      addRef(ann.target);
      if (ann.leader) {
        addRef(ann.leader.from);
        addRef(ann.leader.to);
      }
      collectFromPlace(ann.place, addRef);
      if (typeof ann.text === "string") {
        const matches = ann.text.matchAll(/\{([^{}]+)\}/g);
        for (const m of matches) {
          addRef(m[1].trim());
        }
      }
      break;
    }

    default:
      break;
  }

  // Scan on placement
  if ((obj as any).on && obj.type !== "point") {
    collectFromOn((obj as any).on, addRef);
  }

  // Scan custom anchors
  if (obj.anchors) {
    for (const pos of Object.values(obj.anchors)) {
      if (Array.isArray(pos)) {
        addRef(pos[0]);
        addRef(pos[1]);
      }
    }
  }

  return [...deps];
}

/**
 * Get only the explicit dependencies defined by the user (ignoring structural parent groups)
 * for visualization purposes.
 */
export function getLogicalDependencies(
  id: string,
  obj: RelGeoObject,
  objectIds: Set<string>,
  doc?: RelGeoDocument
): string[] {
  const deps = new Set<string>();

  const addRef = (value: unknown) => {
    for (const refId of extractObjectRefs(value, objectIds)) {
      if (refId !== id) {
        deps.add(refId);
      }
    }
  };

  switch (obj.type) {
    case "point":
      addPointDependencies(obj, addRef);
      break;

    case "line":
      addLineDependencies(obj, addRef);
      break;

    case "rect":
      addRectDependencies(obj, addRef);
      break;

    case "circle":
      addCircleDependencies(obj, addRef);
      break;

    case "ellipse":
      addEllipseDependencies(obj, addRef);
      collectFromPlace((obj as EllipseObject).place, addRef);
      if ((obj as EllipseObject).transform) {
        addTransformDependencies((obj as EllipseObject).transform, addRef);
      }
      break;

    case "group":
      if (Array.isArray((obj as GroupObject).children)) {
        for (const childId of (obj as GroupObject).children) {
          deps.add(childId);
        }
      }
      if ((obj as GroupObject).transform) {
        addTransformDependencies((obj as GroupObject).transform, addRef);
      }
      collectFromPlace((obj as GroupObject).place, addRef);
      break;

    case "text":
      addRef((obj as TextObject).at);
      const content = (obj as TextObject).content;
      if (typeof content === "string") {
        const matches = content.matchAll(/\{([^{}]+)\}/g);
        for (const m of matches) {
          addRef(m[1].trim());
        }
      } else {
        addRef(content);
      }
      collectFromPlace((obj as TextObject).place, addRef);
      break;

    case "arc":
      addArcDependencies(obj, addRef);
      collectFromPlace((obj as ArcObject).place, addRef);
      if ((obj as ArcObject).transform) {
        addTransformDependencies((obj as ArcObject).transform, addRef);
      }
      break;

    case "cubic":
    case "quadratic":
      addCurveDependencies(obj, addRef);
      collectFromPlace((obj as PlaceableObject).place, addRef);
      if ((obj as PlaceableObject).transform) {
        addTransformDependencies((obj as PlaceableObject).transform, addRef);
      }
      break;

    case "path":
    case "polygon":
      addPathDependencies(obj, addRef);
      collectFromPlace((obj as PlaceableObject).place, addRef);
      if ((obj as PlaceableObject).transform) {
        addTransformDependencies((obj as PlaceableObject).transform, addRef);
      }
      break;

    case "clone":
      addRef((obj as CloneObject).of);
      collectFromPlace((obj as CloneObject).place, addRef);
      if ((obj as CloneObject).transform) {
        addTransformDependencies((obj as CloneObject).transform, addRef);
      }
      break;

    case "translate":
    case "rotate":
    case "scale":
    case "mirror":
    case "reverse":
      addOperationObjectDependencies(obj as TranslateObject | RotateObject | ScaleObject | MirrorObject | ReverseObject, addRef);
      break;

    case "repeat":
      addRepeatDependencies(obj as RepeatObject, addRef);
      break;

    case "divide":
      addDivideDependencies(obj as DivideObject, addRef);
      break;

    case "collection":
      if (Array.isArray((obj as CollectionObject).children)) {
        for (const childId of (obj as CollectionObject).children) {
          deps.add(childId);
        }
      }
      break;

    case "component":
      addComponentDependencies(obj, addRef, doc, objectIds);
      break;

    default:
      break;
  }

  // Scan on placement
  if ((obj as any).on && obj.type !== "point") {
    collectFromOn((obj as any).on, addRef);
  }

  // Scan custom anchors
  if (obj.anchors) {
    for (const pos of Object.values(obj.anchors)) {
      if (Array.isArray(pos)) {
        addRef(pos[0]);
        addRef(pos[1]);
      }
    }
  }

  return [...deps];
}

export function sortNodes(
  nodeIds: string[],
  getDeps: (id: string) => string[]
): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const nodeSet = new Set(nodeIds);
  const stack: string[] = [];

  const visit = (id: string) => {
    if (!nodeSet.has(id)) return;

    if (visiting.has(id)) {
      const cycleStartIdx = stack.indexOf(id);
      const chain = [...stack.slice(cycleStartIdx), id];
      throw new ResolveError(
        `Circular dependency detected: ${chain.join(" -> ")}`,
        "CIRCULAR_DEPENDENCY",
        id,
        chain.join(" -> ")
      );
    }

    if (visited.has(id)) return;

    visiting.add(id);
    stack.push(id);

    for (const depId of getDeps(id)) {
      visit(depId);
    }

    stack.pop();
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  };

  for (const id of nodeIds) {
    visit(id);
  }

  return sorted;
}

export function sortObjects(objects: Record<string, RelGeoObject>, doc?: RelGeoDocument): string[] {
  const ids = Object.keys(objects);
  const objectIds = new Set(ids);

  // Build parent map
  const parentMap = new Map<string, string>();
  for (const [groupId, obj] of Object.entries(objects)) {
    if (obj.type === "group" && Array.isArray(obj.children)) {
      for (const childId of obj.children) {
        parentMap.set(childId, groupId);
      }
    } else if (
      (obj.type === "translate" ||
        obj.type === "rotate" ||
        obj.type === "scale" ||
        obj.type === "mirror" ||
        obj.type === "reverse") &&
      (obj as any).target
    ) {
      parentMap.set((obj as any).target, groupId);
    }
  }

  return sortNodes(ids, (id) => {
    const obj = objects[id];

    return getObjectDependencies(id, obj, objectIds, parentMap, doc);
  });
}

export function getDependencyGraph(objects: Record<string, RelGeoObject>, doc?: RelGeoDocument): { id: string, deps: string[] }[] {
    const ids = Object.keys(objects);
    const objectIds = new Set(ids);
    
    return ids.map(id => ({
        id,
        deps: getLogicalDependencies(id, objects[id], objectIds, doc)
    }));
}

/**
 * Unified topological sort across objects AND derived values.
 *
 * Returns an ordered list of node descriptors. Each item is either:
 *   { kind: "object", id: string }  — resolve this object next
 *   { kind: "derived", id: string } — evaluate this derived expression next
 *
 * Dependency rules:
 *   - Object  depends on: other objects it references + derived values it references
 *   - Derived depends on: other derived values + objects it references
 *
 * Cycle detection is performed; throws CIRCULAR_DEPENDENCY if found.
 */
export function sortUnified(
  objects: Record<string, RelGeoObject>,
  derived: Record<string, unknown>,
  doc?: RelGeoDocument
): Array<{ kind: "object" | "derived"; id: string }> {
  const objectIds = new Set(Object.keys(objects));
  const derivedIds = new Set(Object.keys(derived));

  // Prefix-namespace to avoid ID collisions between objects and derived
  const OBJ = (id: string) => `obj:${id}`;
  const DRV = (id: string) => `drv:${id}`;

  // Build parent map (for group-aware object deps)
  const parentMap = new Map<string, string>();
  for (const [groupId, obj] of Object.entries(objects)) {
    if (obj.type === "group" && Array.isArray(obj.children)) {
      for (const childId of obj.children) {
        parentMap.set(childId, groupId);
      }
    } else if (
      (obj.type === "translate" ||
        obj.type === "rotate" ||
        obj.type === "scale" ||
        obj.type === "mirror" ||
        obj.type === "reverse") &&
      (obj as any).target
    ) {
      parentMap.set((obj as any).target, groupId);
    }
  }

  // All unified node IDs (prefixed)
  const allNodes = [
    ...Array.from(objectIds).map(OBJ),
    ...Array.from(derivedIds).map(DRV),
  ];

  const getDeps = (prefixedId: string): string[] => {
    if (prefixedId.startsWith("obj:")) {
      const id = prefixedId.slice(4);
      const obj = objects[id];
      // Object's deps on other objects
      const objDeps = getObjectDependencies(id, obj, objectIds, parentMap, doc)
        .map(OBJ);
      // Object's deps on derived values (any identifier matching a derived ID)
      const allRefs = extractObjectRefsFromAny(obj, objectIds, derivedIds);
      const drvDeps = allRefs
        .filter(ref => derivedIds.has(ref))
        .map(DRV);
      return [...objDeps, ...drvDeps];
    } else {
      // drv:X
      const id = prefixedId.slice(4);
      const def = derived[id];
      const expr = def && typeof def === "object" && !Array.isArray(def) && "value" in (def as any)
        ? (def as any).value
        : def;
      if (typeof expr !== "string") return [];
      // Derived's deps on other derived
      const drvDeps = getExpressionIdentifiers(expr)
        .filter(ref => derivedIds.has(ref) && ref !== id)
        .map(DRV);
      // Derived's deps on objects
      const objDeps = getExpressionIdentifiers(expr)
        .filter(ref => objectIds.has(ref))
        .map(OBJ);
      return [...drvDeps, ...objDeps];
    }
  };

  const sortedPrefixed = sortNodes(allNodes, getDeps);

  return sortedPrefixed.map(prefixedId => {
    if (prefixedId.startsWith("obj:")) {
      return { kind: "object" as const, id: prefixedId.slice(4) };
    } else {
      return { kind: "derived" as const, id: prefixedId.slice(4) };
    }
  });
}

/** Extract all identifiers from a string expression (excluding known functions/keywords). */
function getExpressionIdentifiers(expr: string): string[] {
  const deps = new Set<string>();
  const matches = expr.match(/[a-zA-Z_][a-zA-Z0-9_]*/g);
  if (!matches) return [];
  for (const m of matches) {
    if (KNOWN_FUNCTIONS.has(m)) continue;
    deps.add(m);
  }
  return [...deps];
}

/** Recursively extract all string values from an object, filtering against known ID sets. */
function extractObjectRefsFromAny(
  val: unknown,
  objectIds: Set<string>,
  derivedIds: Set<string>
): string[] {
  if (typeof val === "string") {
    const refs: string[] = [];
    const identifiers = getExpressionIdentifiers(val);
    for (const id of identifiers) {
      if (objectIds.has(id) || derivedIds.has(id)) {
        refs.push(id);
      }
    }
    return refs;
  }
  if (Array.isArray(val)) {
    return val.flatMap(item => extractObjectRefsFromAny(item, objectIds, derivedIds));
  }
  if (val && typeof val === "object") {
    return Object.values(val).flatMap(v => extractObjectRefsFromAny(v, objectIds, derivedIds));
  }
  return [];
}


function addTransformDependencies(
  transform: any,
  addRef: (value: unknown) => void
) {
  if (!transform) return;

  const addOpDeps = (op: any) => {
    if (op.translate) {
      addRef(op.translate[0]);
      addRef(op.translate[1]);
    }
    if (op.rotate) {
      if (typeof op.rotate === 'object') {
        addRef(op.rotate.angle);
        addRef(op.rotate.origin);
      } else {
        addRef(op.rotate);
      }
    }
    if (op.scale) {
      if (typeof op.scale === 'object' && !Array.isArray(op.scale)) {
        addRef(op.scale.factor);
        addRef(op.scale.origin);
      } else {
        addRef(op.scale);
      }
    }
    if (op.mirror) {
      if (typeof op.mirror === 'object') {
        addRef(op.mirror.origin);
      }
    }
    if (op.origin) {
      addRef(op.origin);
    }
  };

  if (Array.isArray(transform)) {
    transform.forEach(addOpDeps);
  } else {
    addOpDeps(transform);
  }
}
