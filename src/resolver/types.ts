import type { LengthUnit, RelGeoMode, RelGeoError, RelGeoErrorCode, SourceRange, TextMetricsProvider } from "../types";

export interface ResolveOptions {
    profile?: string;
    targetUnit?: LengthUnit;
    overrides?: Record<string, any>;
    mode?: RelGeoMode;
    textMetrics?: TextMetricsProvider;
}

export interface ResolveContext {
    scalars: Record<string, any>;
    objects: Record<string, any>;
    targetUnit: LengthUnit;
    parentMap?: Map<string, string>;
    currentObjectId?: string;
    mode?: RelGeoMode;
    textMetrics: TextMetricsProvider;
    doc?: any;
}

export class ResolveError extends Error implements RelGeoError {
    phase = "resolve" as const;
    severity = "error" as const;
    range?: SourceRange;
    dependencyChain?: string[];

    constructor(
        message: string,
        public code?: RelGeoErrorCode,
        public objectId?: string,
        public path?: string,
        range?: SourceRange
    ) {
        const fullMessage = code ? `${code}: ${message}` : message;
        super(fullMessage);
        this.message = fullMessage;
        this.name = "ResolveError";
        this.range = range;
    }
}
