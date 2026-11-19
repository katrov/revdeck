export interface VirtualLayout {
    pageCount: number;
    heights: number[];
    offsets: number[];
    total: number;
}

/** Высоты страниц: измеренные значения, иначе оценка estimate * pageSize. */
export function buildPageLayout(itemCount: number, pageSize: number, estimate: number, measured: number[]): VirtualLayout {
    const pageCount = Math.max(0, Math.ceil(itemCount / pageSize));
    const fallback = estimate * pageSize;
    const heights = Array.from({ length: pageCount }, (_, index) => {
        const value = measured[index];
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    });
    const offsets = new Array<number>(pageCount);
    let total = 0;
    for (let index = 0; index < pageCount; index += 1) {
        offsets[index] = total;
        total += heights[index]!;
    }
    return { pageCount, heights, offsets, total };
}

/** Диапазон страниц [start, end), пересекающих viewport с overscan. */
export function pageRange(layout: VirtualLayout, top: number, bottom: number, overscanPx: number): { start: number; end: number } {
    if (layout.pageCount === 0) return { start: 0, end: 0 };
    const from = Math.max(0, top - overscanPx);
    const to = bottom + overscanPx;
    let start = 0;
    while (start < layout.pageCount && layout.offsets[start]! + layout.heights[start]! < from) {
        start += 1;
    }
    let end = start;
    while (end < layout.pageCount && layout.offsets[end]! < to) {
        end += 1;
    }
    return { start, end };
}
