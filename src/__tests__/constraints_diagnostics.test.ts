import { describe, it, expect } from 'vitest';
import { resolveGeometry } from '../resolver';
import { RelGeoDocument } from '../types';

describe('Constraint Diagnostics', () => {
    it('accepts the complete valid relation matrix without mutating the scene', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                horizontal: { type: 'line', from: [-20, 0], to: [20, 0] },
                horizontalOffset: { type: 'line', from: [-20, 10], to: [20, 10] },
                vertical: { type: 'line', from: [0, -20], to: [0, 20] },
                tangent: { type: 'line', from: [-20, 10], to: [20, 10] },
                circle: { type: 'circle', center: [0, 0], radius: 10 },
            },
            constraints: [
                { equal: ['horizontal.length', 'horizontalOffset.length'] },
                { parallel: ['horizontal', 'horizontalOffset'] },
                { perpendicular: ['horizontal', 'vertical'] },
                { tangent: ['tangent', 'circle'] },
            ],
        };

        const result = resolveGeometry(doc);
        expect(result.violations).toEqual([]);
        expect(result.objects.horizontal).toMatchObject({ type: 'line', x1: -20, x2: 20 });
    });

    it('should report align violation for non-aligned points', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                p1: { type: 'point', at: [0, 0] },
                p2: { type: 'point', at: [10, 10] }
            },
            constraints: [
                { align: { target: 'p1', with: 'p2' } }
            ]
        };

        const result = resolveGeometry(doc);
        expect(result.violations).toBeDefined();
        expect(result.violations?.length).toBe(1);
        expect(result.violations?.[0].type).toBe('align');
        expect(result.violations?.[0].deviation).toBeGreaterThan(0);
        expect(result.violations?.[0].involvedObjects).toEqual(['p1', 'p2']);
        expect(result.violations?.[0]).toMatchObject({
            severity: 'error',
            origin: 'constraint',
            expected: { deviation: 0, tolerance: 0.001 },
            actual: { deviation: expect.any(Number) },
        });
    });

    it('should report parallel violation for non-parallel lines', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                l1: { type: 'line', from: [0, 0], length: 100, direction: 'right' },
                l2: { type: 'line', from: [0, 20], length: 100, direction: 'up' } // 90 deg diff
            },
            constraints: [
                { parallel: ['l1', 'l2'] }
            ]
        };

        const result = resolveGeometry(doc);
        expect(result.violations?.length).toBe(1);
    expect(result.violations?.[0].type).toBe('parallel');
    expect(result.violations?.[0].deviation).toBeCloseTo(Math.PI / 2);
    expect(result.violations?.[0].involvedObjects).toEqual(['l1', 'l2']);
    });

    it('should accept equal constraint object-form and report violation when values differ', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                l1: { type: 'line', from: [0, 0], to: [100, 0] },
                l2: { type: 'line', from: [0, 10], to: [80, 10] }
            },
            constraints: [
                { equal: { left: 'l1.length', right: 'l2.length' } }
            ]
        };

        const result = resolveGeometry(doc);
        expect(result.violations?.length).toBe(1);
        expect(result.violations?.[0].type).toBe('equal');
        expect(result.violations?.[0].deviation).toBeGreaterThan(0);
        expect(result.violations?.[0].involvedObjects).toEqual(['l1', 'l2']);
    });

    it('should reject unknown equal-constraint references during validation', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                line: { type: 'line', from: [0, 0], to: [10, 0] },
            },
            constraints: [
                { equal: ['missing.length', 'line.length'] },
            ],
        };

        expect(() => resolveGeometry(doc)).toThrowError(expect.objectContaining({
            code: 'UNKNOWN_REFERENCE',
            path: 'constraints[0].equal[0]',
        }));
    });

    it('should report relation violations for degenerate geometry', () => {
        const doc: RelGeoDocument = {
            version: '1.0',
            objects: {
                flat: { type: 'line', from: [0, 0], to: [0, 0] },
                guide: { type: 'line', from: [0, 20], to: [100, 20] },
                circle: { type: 'circle', center: [50, 50], radius: 1 }
            },
            constraints: [
                { parallel: ['flat', 'guide'] },
                { tangent: ['flat', 'circle'] }
            ]
        };

        const result = resolveGeometry(doc);
        expect(result.violations).toHaveLength(2);
        expect(result.violations?.map(violation => violation.type)).toEqual(['parallel', 'tangent']);
        expect(result.violations?.map(violation => violation.path)).toEqual(['constraints[0]', 'constraints[1]']);
        expect(result.violations?.every(violation => violation.deviation > 0)).toBe(true);
        expect(result.violations?.every(violation =>
            violation.severity === 'error'
            && violation.origin === 'constraint'
            && typeof violation.expected === 'object'
            && typeof violation.actual === 'object',
        )).toBe(true);
        expect(result.violations?.map(violation => violation.involvedObjects)).toEqual([
            ['flat', 'guide'],
            ['flat', 'circle'],
        ]);
    });
});
