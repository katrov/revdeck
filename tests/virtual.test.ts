import { describe, expect, it } from 'vitest';
import { buildPageLayout, pageRange } from '../ui/src/lib/virtual.js';

describe('virtual list layout', () => {
    it('builds page offsets from estimates and measurements', () => {
        expect(buildPageLayout(25, 10, 100, [])).toEqual({
            pageCount: 3,
            heights: [1000, 1000, 1000],
            offsets: [0, 1000, 2000],
            total: 3000,
        });

        const measured = buildPageLayout(25, 10, 100, [1200, 0, 0]);
        expect(measured.heights).toEqual([1200, 1000, 1000]);
        expect(measured.offsets).toEqual([0, 1200, 2200]);
        expect(measured.total).toBe(3200);
    });

    it('returns an empty layout for an empty list', () => {
        expect(buildPageLayout(0, 10, 100, [])).toEqual({ pageCount: 0, heights: [], offsets: [], total: 0 });
        expect(pageRange(buildPageLayout(0, 10, 100, []), 0, 800, 0)).toEqual({ start: 0, end: 0 });
    });

    it('finds the pages intersecting the viewport with overscan', () => {
        const layout = buildPageLayout(100, 10, 100, []);
        expect(pageRange(layout, 0, 800, 0)).toEqual({ start: 0, end: 1 });
        expect(pageRange(layout, 900, 1500, 0)).toEqual({ start: 0, end: 2 });
        expect(pageRange(layout, 2500, 3000, 0)).toEqual({ start: 2, end: 3 });
        expect(pageRange(layout, 2000, 2400, 500)).toEqual({ start: 1, end: 3 });
    });

    it('does not produce a negative or overflowing range', () => {
        const layout = buildPageLayout(30, 10, 100, []);
        expect(pageRange(layout, -500, 0, 1000)).toEqual({ start: 0, end: 1 });
        expect(pageRange(layout, 99999, 100000, 0)).toEqual({ start: 3, end: 3 });
    });
});
