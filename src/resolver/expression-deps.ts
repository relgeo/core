import { KNOWN_FUNCTIONS, RESERVED_KEYWORDS } from "../constants";

export function getExpressionDependencies(expr: unknown): string[] {
    if (typeof expr !== "string") return [];

    const deps = new Set<string>();

    const matches = expr.match(/[a-zA-Z_][a-zA-Z0-9_]*/g);

    if (!matches) return [];

    for (const match of matches) {
        if (KNOWN_FUNCTIONS.has(match)) continue;
        if (RESERVED_KEYWORDS.has(match)) continue;

        deps.add(match);
    }

    return [...deps];
}