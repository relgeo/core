import type {
  LengthUnit,
  Orientation,
  Origin,
  Meta,
} from "relgeo-geometry";

export * from "relgeo-geometry";
export type RelGeoMode = "editor" | "validate" | "compile";

export type ExpressionValue = string | number;
export type ObjectRef = string;
export type AnchorRef = string | number | [ExpressionValue, ExpressionValue];

export type RelGeoObjectType =
  | "point"
  | "line"
  | "rect"
  | "circle"
  | "ellipse"
  | "group"
  | "text"
  | "path"
  | "polygon"
  | "clone"
  | "arc"
  | "cubic"
  | "quadratic"
  | "boolean"
  | "repeat"
  | "divide"
  | "collection"
  | "component"
  | "dimension"
  | "annotation"
  | "translate"
  | "rotate"
  | "scale"
  | "mirror"
  | "reverse"
  | "split";

export interface Scene {
  unit?: LengthUnit;
  orientation?: Orientation;
  origin?: Origin;
  padding?: ExpressionValue;
  autoSize?: boolean;
}

export type ParameterType =
  | "length"
  | "number"
  | "angle"
  | "percent"
  | "boolean"
  | "enum"
  | "string"
  | "point"
  | "vector"
  | "array"
  | "object"
  | "frame2d"
  | "bbox2d"
  | "collection"
  | "path-ref";

export interface ParameterDef {
  type: ParameterType;
  default: unknown;
  min?: unknown;
  max?: unknown;
  step?: unknown;
  label?: string;
  category?: string;
  description?: string;
  options?: string[];
}

export interface ConstantDef {
  value: unknown;
}

export interface DerivedDef {
  value: string;
}



export interface BaseObject {
  id?: string;
  type: RelGeoObjectType;
  meta?: Meta;
  metaPreset?: string;
  style?: string;
  anchors?: Record<string, [ExpressionValue, ExpressionValue]>;
}

export type Direction = "left" | "right" | "up" | "down";

export interface MoveSpec {
  right?: ExpressionValue;
  left?: ExpressionValue;
  up?: ExpressionValue;
  down?: ExpressionValue;
  x?: ExpressionValue;
  y?: ExpressionValue;
  angle?: ExpressionValue;
  distance?: ExpressionValue;
}

export interface BaseOnSpec {
  anchor?: AnchorRef;
}

export interface PointOnSpec extends BaseOnSpec {
  at: ExpressionValue;
}

export interface PathOnSpec extends BaseOnSpec {
  path: ExpressionValue;
  t: ExpressionValue;
}

export interface OnSpec {
  point?: PointOnSpec;
  path?: PathOnSpec;
  frame?: PathOnSpec;
}

export interface PointObject extends BaseObject {
  type: "point";
  at?: "origin" | [ExpressionValue, ExpressionValue] | AnchorRef;
  from?: AnchorRef;
  move?: MoveSpec;
  on?: OnSpec;
  pointShape?: ExpressionValue;
  color?: ExpressionValue;
}

export interface LineObject extends BaseObject {
  type: "line";
  from: AnchorRef;
  to?: AnchorRef;
  direction?: Direction;
  length?: ExpressionValue;
  tangent?: {
    from: AnchorRef;
    to: ObjectRef;
    pick?: "first" | "last" | number | string;
  };
}

export interface PlaceSpec {
  left?: ExpressionValue;
  right?: ExpressionValue;
  top?: ExpressionValue;
  bottom?: ExpressionValue;

  centerX?: ExpressionValue;
  centerY?: ExpressionValue;

  center?: AnchorRef;
  topLeft?: AnchorRef;
  topRight?: AnchorRef;
  bottomLeft?: AnchorRef;
  bottomRight?: AnchorRef;
  topCenter?: AnchorRef;
  bottomCenter?: AnchorRef;
  centerLeft?: AnchorRef;
  centerRight?: AnchorRef;

  inside?: ObjectRef;
  margin?: ExpressionValue;

  align?: {
    target: AnchorRef;
    to?: "left" | "right" | "center" | "top" | "bottom";
    offset?: ExpressionValue;
  };
}



export interface PlaceableObject extends BaseObject {
  place?: PlaceSpec;
  on?: OnSpec;
  transform?: TransformSpec;
}

export interface RectObject extends PlaceableObject {
  type: "rect";
  size: [ExpressionValue, ExpressionValue];
  holes?: ({ segments: PathSegment[] } | string | any)[];
}

export interface CircleObject extends PlaceableObject {
  type: "circle";
  center?: AnchorRef;
  radius?: ExpressionValue;
  through?: AnchorRef;
  holes?: ({ segments: PathSegment[] } | string | any)[];
}

export interface EllipseObject extends PlaceableObject {
  type: "ellipse";
  center?: AnchorRef;
  rx?: ExpressionValue;
  ry?: ExpressionValue;
  size?: [ExpressionValue, ExpressionValue];
  rotation?: ExpressionValue;
  holes?: ({ segments: PathSegment[] } | string | any)[];
}

export interface ArcObject extends PlaceableObject {
  type: "arc";
  from?: AnchorRef;
  through?: AnchorRef;
  to?: AnchorRef;
  center?: AnchorRef;
  radius?: ExpressionValue;
  startAngle?: ExpressionValue;
  endAngle?: ExpressionValue;
}

export interface CubicObject extends PlaceableObject {
  type: "cubic";
  from: AnchorRef;
  cp1: AnchorRef;
  cp2: AnchorRef;
  to: AnchorRef;
}

export interface QuadraticObject extends PlaceableObject {
  type: "quadratic";
  from: AnchorRef;
  cp: AnchorRef;
  to: AnchorRef;
}

export interface TranslateOp {
  translate: [ExpressionValue, ExpressionValue];
}

export interface RotateOp {
  rotate:
  | ExpressionValue
  | {
    angle: ExpressionValue;
    origin?: AnchorRef | [ExpressionValue, ExpressionValue];
  };
}

export interface ScaleOp {
  scale:
  | ExpressionValue
  | [ExpressionValue, ExpressionValue]
  | {
    factor: ExpressionValue | [ExpressionValue, ExpressionValue];
    origin?: AnchorRef | [ExpressionValue, ExpressionValue];
  };
}

export interface MirrorOp {
  mirror:
  | "x"
  | "y"
  | "both"
  | {
    axis: "x" | "y" | "both";
    origin?: AnchorRef | [ExpressionValue, ExpressionValue];
  };
}

export type TransformOperation =
  | TranslateOp
  | RotateOp
  | ScaleOp
  | MirrorOp;

export interface TransformSpecObject {
  translate?: [ExpressionValue, ExpressionValue];
  rotate?: ExpressionValue;
  scale?: ExpressionValue | [ExpressionValue, ExpressionValue];
  mirror?: "x" | "y" | "both";
  origin?: AnchorRef | [ExpressionValue, ExpressionValue];
}

export type TransformSpec = TransformSpecObject | TransformOperation[];


export interface GroupObject extends PlaceableObject {
  type: "group";
  children: ObjectRef[];
  transform?: TransformSpec;
}

export interface TextObject extends PlaceableObject {
  type: "text";
  at?: AnchorRef;
  content: ExpressionValue;
  anchor?:
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "centerLeft"
  | "center"
  | "centerRight"
  | "bottomLeft"
  | "bottomCenter"
  | "bottomRight";
}

export type PathSegment =
  | { line: { from?: AnchorRef; to: AnchorRef } }
  | { arc: { from?: AnchorRef; through: AnchorRef; to: AnchorRef } }
  | { quadratic: { from?: AnchorRef; cp: AnchorRef; to: AnchorRef } }
  | { cubic: { from?: AnchorRef; cp1: AnchorRef; cp2: AnchorRef; to: AnchorRef } };

export type PathCloseWith = "none" | "line";

export interface PathObject extends PlaceableObject {
  type: "path";
  points?: AnchorRef[];
  segments?: PathSegment[];
  join?: ObjectRef[];
  closed?: boolean;
  closeWith?: PathCloseWith;
  offset?: {
    from: ObjectRef;
    distance: ExpressionValue;
    side?: "left" | "right" | "inside" | "outside";
  };
  corners?: Record<string, { fillet?: ExpressionValue; chamfer?: ExpressionValue }>;
  corner?: { all?: { fillet?: ExpressionValue; chamfer?: ExpressionValue } } ;
  holes?: ({ segments: PathSegment[] } | string | any)[];
}

export interface PolygonObject extends PlaceableObject {
  type: "polygon";
  points: AnchorRef[];
  corner?: { all?: { fillet?: ExpressionValue; chamfer?: ExpressionValue } };
  corners?: Record<string, { fillet?: ExpressionValue; chamfer?: ExpressionValue }>;
  holes?: ({ segments: PathSegment[] } | string | any)[];
}

export interface CloneObject extends PlaceableObject {
  type: "clone";
  of: ObjectRef;
  transform?: TransformSpec;
}

export interface TranslateObject extends BaseObject {
  type: "translate";
  target: ObjectRef;
  by: [ExpressionValue, ExpressionValue];
}

export interface RotateObject extends BaseObject {
  type: "rotate";
  target: ObjectRef;
  angle: ExpressionValue;
  origin?: AnchorRef | [ExpressionValue, ExpressionValue];
}

export interface ScaleObject extends BaseObject {
  type: "scale";
  target: ObjectRef;
  factor: ExpressionValue | [ExpressionValue, ExpressionValue];
  origin?: AnchorRef | [ExpressionValue, ExpressionValue];
}

export interface MirrorObject extends BaseObject {
  type: "mirror";
  target: ObjectRef;
  axis: "x" | "y" | "both";
  origin?: AnchorRef | [ExpressionValue, ExpressionValue];
}

export interface ReverseObject extends BaseObject {
  type: "reverse";
  target: ObjectRef;
}

export interface SplitObject extends BaseObject {
  type: "split";
  target: ObjectRef;
  at: AnchorRef;
  pick?: "first" | "last";
}

export interface BooleanObject extends PlaceableObject {
  type: "boolean";
  operation: "union" | "subtract" | "intersect" | "xor";
  shapes?: ObjectRef[];
  base?: ObjectRef;
  tools?: ObjectRef[];
  result?: {
    mode?: "single" | "multi";
  };
  holes?: { segments: PathSegment[] }[];
}

export interface RepeatGridDef {
  rows: ExpressionValue;
  cols: ExpressionValue;
  gap?: [ExpressionValue, ExpressionValue] | ExpressionValue;
  pitch?: [ExpressionValue, ExpressionValue] | ExpressionValue;
}

export interface RepeatPolarDef {
  count: ExpressionValue;
  center: AnchorRef;
  radius: ExpressionValue;
}

export type RepeatAlongSpacing = "uniform-length" | "uniform-t" | "fixed-distance";

export interface RepeatAlongDef {
  target: ObjectRef;
  spacing: RepeatAlongSpacing;
  count?: ExpressionValue;
  distance?: ExpressionValue;
  startOffset?: ExpressionValue;
  endOffset?: ExpressionValue;
}

export interface RepeatObject extends BaseObject {
  type: "repeat";
  count?: ExpressionValue;
  each?: any;
  grid?: RepeatGridDef;
  polar?: RepeatPolarDef;
  along?: RepeatAlongDef;
  place?: PlaceSpec;
  transform?: TransformSpec;
  item: RelGeoObject;
}

export interface DivideObject extends BaseObject {
  type: "divide";
  target: ObjectRef;
  count: ExpressionValue;
}

export interface CollectionObject extends BaseObject {
  type: "collection";
  children: ObjectRef[];
}

export interface ComponentInstanceObject extends BaseObject {
  type: "component";
  use: string;
  params?: Record<string, unknown>;
  place?: Record<string, unknown>;
  on?: OnSpec;
  transform?: any[];
}

export interface ComponentDefinition {
  parameters?: Record<string, ParameterDef | any>;
  derived?: Record<string, string | DerivedDef>;
  objects: Record<string, RelGeoObject>;
  exports?: Record<string, ExpressionValue>;
  meta?: Record<string, unknown>;
}

export interface DimensionObject extends BaseObject {
  type: "dimension";
  kind: "linear" | "radius" | "diameter" | "angle";
  from?: AnchorRef;
  to?: AnchorRef;
  offset?: ExpressionValue;
  target?: ObjectRef;
  between?: ObjectRef[];
  text?: string;
}

export interface AnnotationLeader {
  from: AnchorRef;
  to: AnchorRef;
}

export interface AnnotationObject extends BaseObject {
  type: "annotation";
  target?: ObjectRef;
  text: string;
  leader?: AnnotationLeader;
  place?: PlaceSpec;
}

export type RelGeoObject =
  | PointObject
  | LineObject
  | RectObject
  | CircleObject
  | EllipseObject
  | GroupObject
  | TextObject
  | PathObject
  | PolygonObject
  | CloneObject
  | TranslateObject
  | RotateObject
  | ScaleObject
  | MirrorObject
  | ReverseObject
  | SplitObject
  | ArcObject
  | CubicObject
  | QuadraticObject
  | BooleanObject
  | RepeatObject
  | DivideObject
  | CollectionObject
  | ComponentInstanceObject
  | DimensionObject
  | AnnotationObject;

export interface AlignConstraint {
  align: {
    target: AnchorRef;
    with: AnchorRef;
    offset?: ExpressionValue;
  };
}

export interface EqualConstraint {
  equal: ExpressionValue[] | { left: ExpressionValue; right: ExpressionValue };
}

export interface PerpendicularConstraint {
  perpendicular: [ObjectRef, ObjectRef];
}

export interface ParallelConstraint {
  parallel: [ObjectRef, ObjectRef];
}

export interface TangentConstraint {
  tangent: [ObjectRef, ObjectRef];
}

export type ConstraintObject =
  | AlignConstraint
  | EqualConstraint
  | PerpendicularConstraint
  | ParallelConstraint
  | TangentConstraint;

export interface ViewDefinition {
  target: string;
  scale?: string | number;
  filter?: {
    roles?: string[];
  };
  meta?: Record<string, any>;
}

export interface SheetViewPlacement {
  use: string;
  place?: {
    topLeft?: [string | number, string | number] | string | number[];
    center?: [string | number, string | number] | string | number[];
  };
  meta?: Record<string, any>;
}

export interface SheetDefinition {
  size: string | [string | number, string | number];
  orientation?: "portrait" | "landscape";
  views?: SheetViewPlacement[];
  meta?: Record<string, any>;
}

export interface RelGeoDocument {
  version?: string | number;
  scene?: Scene;
  parameters?: Record<string, ParameterDef | any>;
  constants?: Record<string, ConstantDef | any>;
  derived?: Record<string, DerivedDef | string>;
  profiles?: Record<string, Record<string, unknown>>;
  metaPresets?: Record<string, Record<string, unknown>>;
  styles?: Record<string, Record<string, unknown>>;
  components?: Record<string, ComponentDefinition>;
  objects?: Record<string, RelGeoObject>;
  constraints?: ConstraintObject[];
  meta?: Record<string, unknown>;
  sheets?: Record<string, SheetDefinition>;
  views?: Record<string, ViewDefinition>;
}




export type RelGeoErrorCode =
  | "COMPONENT_NOT_FOUND"
  | "UNKNOWN_FIELD"
  | "INVALID_OBJECT_TYPE"
  | "UNKNOWN_REFERENCE"
  | "UNKNOWN_ANCHOR"
  | "UNKNOWN_IDENTIFIER"
  | "INVALID_EXPRESSION"
  | "INVALID_OPERATOR"
  | "DIVISION_BY_ZERO"
  | "TYPE_MISMATCH"
  | "UNKNOWN_FUNCTION"
  | "CIRCULAR_DEPENDENCY"
  | "UNDER_CONSTRAINED"
  | "OVER_CONSTRAINED"
  | "MISSING_REQUIRED_FIELD"
  | "UNSUPPORTED_FEATURE"
  | "CONSTRAINT_VIOLATION"
  | "INVALID_GEOMETRY_OPERATION"
  | "PATH_NOT_CLOSED"
  | "PATH_JOIN_GAP"
  | "PATH_JOIN_DIRECTION_MISMATCH"
  | "MULTIPLE_INTERSECTIONS"
  | "NO_INTERSECTION"
  | "TANGENT_NOT_FOUND"
  | "INVALID_JOIN_TARGET"
  | "INVALID_CLOSE_WITH"
  | "INVALID_OFFSET"
  | "DEGENERATE_ARC"
  | "SELF_INTERSECTING_PATH"
  | "INVALID_CORNER_OPERATION"
  | "INVALID_CONSTRAINT"
  | "BOOLEAN_MULTIPART_RESULT"
  | "DIMENSION_TARGET_INVALID"
  | "ANNOTATION_TARGET_INVALID"
  | "INVALID_REPEAT_COUNT"
  | "INVALID_GRID_SPACING"
  | "OVER_CONSTRAINED_REPEAT_LAYOUT"
  | "INVALID_REPEAT_ALONG_TARGET"
  | "INVALID_REPEAT_ALONG_SPACING"
  | "INVALID_FIXED_DISTANCE"
  | "ELLIPSE_INVALID_RADIUS"
  | "ELLIPSE_SIZE_CONFLICT"
  | "INVALID_REVERSE_TARGET"
  | "INVALID_SPLIT_TARGET"
  | "SPLIT_POINT_OFF_TARGET"
  | "DEGENERATE_SPLIT"
  | "SPLIT_RESOLUTION_FAILED";

export interface RelGeoError {
  message: string;
  path?: string;
  code?: RelGeoErrorCode | string;
  objectId?: string;
  dependencyChain?: string[];
}

export type TextMeasureInput = {
  content: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic" | "oblique";
  lineHeight: number;
};

export type TextMeasureResult = {
  width: number;
  height: number;
  ascent: number;
  descent: number;
};

export interface TextMetricsProvider {
  measure(input: TextMeasureInput): TextMeasureResult;
}

export const defaultTextMetricsProvider: TextMetricsProvider = {
  measure({ content, fontSize, lineHeight }) {
    const lines = String(content ?? "").split("\n");
    const avgCharWidth = fontSize * 0.6;
    const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
    return {
      width: longestLine * avgCharWidth,
      height: lines.length * fontSize * lineHeight,
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
    };
  },
};
