import { describe, it, expect } from 'vitest';
import { resolveGeometry } from '../resolver';
import { RelGeoDocument } from '../types';

describe('Constraint Diagnostics', () => {
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
    });
});
