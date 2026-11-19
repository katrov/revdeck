<script lang="ts" generics="T">
    import { tick, untrack, type Snippet } from 'svelte';
    import { buildPageLayout, pageRange } from '../lib/virtual';

    let {
        items,
        keyOf,
        item,
        estimate = 360,
        pageSize = 10,
        overscan = 1,
        threshold = 30,
        focusKey = null,
    }: {
        items: T[];
        keyOf: (item: T, index: number) => string;
        item: Snippet<[T, number]>;
        /** Оценка высоты одной карточки до измерения. */
        estimate?: number;
        pageSize?: number;
        /** Сколько страниц дорисовывать сверху и снизу. */
        overscan?: number;
        /** До этого числа элементов список рендерится целиком. */
        threshold?: number;
        /** Ключ элемента, к которому нужно проскроллить (deep link). */
        focusKey?: string | null;
    } = $props();

    let root = $state<HTMLDivElement | null>(null);
    let container = $state<HTMLDivElement | null>(null);
    /** Реальный scroll-контейнер: .content в приложении, window — в изоляции. */
    let scroller = $state<HTMLElement | null>(null);
    let scrollY = $state(0);
    let viewport = $state(0);
    let listTop = $state(0);
    let pageHeights = $state<number[]>([]);
    let pinnedPages = $state<number[]>([]);
    let signature = $state('');

    const enabled = $derived(items.length > threshold);

    // Дешёвая подпись структуры: по ней сбрасываются измерения при смене
    // фильтра/порядка/набора элементов, но не при правке текста в карточке.
    const keySignature = $derived.by(() => {
        let hash = 2166136261;
        for (let index = 0; index < items.length; index += 1) {
            const key = keyOf(items[index]!, index);
            for (let offset = 0; offset < key.length; offset += 1) {
                hash = Math.imul(hash ^ key.charCodeAt(offset), 16777619);
            }
            hash = Math.imul(hash ^ 31, 16777619);
        }
        return `${items.length}:${(hash >>> 0).toString(36)}`;
    });

    $effect(() => {
        keySignature;
        signature = keySignature;
        pageHeights = new Array(Math.ceil(items.length / pageSize)).fill(estimate * pageSize);
        pinnedPages = [];
    });

    const layout = $derived(buildPageLayout(items.length, pageSize, estimate, pageHeights));

    const visiblePages = $derived.by(() => {
        if (!enabled || layout.pageCount === 0) return [];
        const top = Math.max(0, scrollY - listTop);
        const bottom = top + Math.max(viewport, 1);
        const range = pageRange(layout, top, bottom, overscan * estimate * pageSize);
        const pages = new Set<number>();
        for (let page = range.start; page < range.end; page += 1) pages.add(page);
        for (const page of pinnedPages) {
            if (page >= 0 && page < layout.pageCount) pages.add(page);
        }
        // Если фильтр уменьшил список, пока мы были внизу, scrollTop успевает
        // оказаться за пределами новой высоты; не оставляем пустой экран.
        if (pages.size === 0 && layout.pageCount > 0) pages.add(layout.pageCount - 1);
        return [...pages].sort((left, right) => left - right);
    });

    function findScroller(node: HTMLElement): HTMLElement | null {
        let parent = node.parentElement;
        while (parent) {
            const overflow = getComputedStyle(parent).overflowY;
            if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return parent;
            parent = parent.parentElement;
        }
        return null;
    }

    function scrollTop(): number {
        return scroller ? scroller.scrollTop : window.scrollY;
    }

    function updateViewport(): void {
        if (!container) return;
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        scrollY = scrollTop();
        viewport = scroller ? scroller.clientHeight : window.innerHeight;
        listTop = container.getBoundingClientRect().top - top + scrollY;
    }

    $effect(() => {
        const node = root;
        if (!node) return;
        scroller = findScroller(node);
        const target: HTMLElement | Window = scroller ?? window;
        let frame = 0;
        const schedule = (): void => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                updateViewport();
            });
        };
        target.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        updateViewport();
        return () => {
            if (frame) cancelAnimationFrame(frame);
            target.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
        };
    });

    $effect(() => {
        if (!enabled) return;
        keySignature;
        void tick().then(updateViewport);
    });

    function pin(page: number): void {
        if (!pinnedPages.includes(page)) pinnedPages = [...pinnedPages, page];
    }

    function pageOf(element: Element | null): number | null {
        const node = element?.closest('[data-vpage]');
        if (!node) return null;
        const value = Number(node.getAttribute('data-vpage'));
        return Number.isInteger(value) ? value : null;
    }

    $effect(() => {
        const node = root;
        if (!node) return;
        const focusIn = (event: FocusEvent): void => {
            const page = pageOf(event.target as Element);
            if (page !== null) pin(page);
        };
        const focusOut = (): void => {
            // focusout приходит до focusin следующего элемента.
            setTimeout(() => {
                const page = pageOf(document.activeElement);
                pinnedPages = page === null ? [] : [page];
            }, 0);
        };
        node.addEventListener('focusin', focusIn);
        node.addEventListener('focusout', focusOut);
        return () => {
            node.removeEventListener('focusin', focusIn);
            node.removeEventListener('focusout', focusOut);
        };
    });

    $effect(() => {
        const key = focusKey;
        if (!key || !enabled) return;
        const index = items.findIndex((entry, position) => keyOf(entry, position) === key);
        if (index < 0) return;
        const page = Math.floor(index / pageSize);
        if (!untrack(() => pinnedPages.includes(page))) pin(page);
        void tick().then(() => {
            const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
            const node = container?.querySelector<HTMLElement>(`[data-vkey="${escaped}"]`);
            if (!node) return;
            const offsets = untrack(() => layout.offsets);
            const pageOffset = offsets[page] ?? 0;
            const nodeOffset = node.offsetTop;
            const height = untrack(() => (scroller ? scroller.clientHeight : window.innerHeight));
            const target = pageOffset + nodeOffset - Math.max(0, (height - node.offsetHeight) / 2);
            const targetScroller = untrack(() => scroller);
            if (targetScroller) targetScroller.scrollTop = Math.max(0, target);
            else window.scrollTo({ top: Math.max(0, target + untrack(() => listTop)) });
            updateViewport();
        });
    });

    function measurePage(node: HTMLElement, page: number): { destroy: () => void } {
        const measure = (): void => {
            const height = Math.ceil(node.getBoundingClientRect().height);
            if (!Number.isFinite(height) || height <= 0) return;
            const previous = pageHeights[page] ?? estimate * pageSize;
            if (Math.abs(previous - height) < 1) return;
            // scrollY может отставать на кадр от реального scrollTop; для
            // якоря берём живое значение, иначе страница над viewport
            // измеряется «после» scrollIntoView и якорь не срабатывает.
            const liveScroll = scroller ? scroller.scrollTop : window.scrollY;
            const liveTop = scroller ? scroller.getBoundingClientRect().top : 0;
            const liveListTop = container ? container.getBoundingClientRect().top - liveTop + liveScroll : 0;
            const top = Math.max(0, liveScroll - liveListTop);
            const pageTop = layout.offsets[page] ?? 0;
            const above = pageTop + previous <= top;
            const next = pageHeights.slice();
            next[page] = height;
            pageHeights = next;
            if (above) {
                const delta = height - previous;
                if (delta) {
                    if (scroller) scroller.scrollTop += delta;
                    else window.scrollBy(0, delta);
                }
            }
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return { destroy: () => observer.disconnect() };
    }
</script>

<div class="v-root" bind:this={root}>
    {#if !enabled}
        {#each items as entry, index (keyOf(entry, index))}
            {@render item(entry, index)}
        {/each}
    {:else}
        <div class="v-container" bind:this={container} style={`height:${layout.total}px`}>
            {#each visiblePages as page (`${page}:${signature}`)}
                <div
                    class="v-page"
                    data-vpage={page}
                    style={`transform:translateY(${layout.offsets[page] ?? 0}px)`}
                    use:measurePage={page}
                >
                    {#each items.slice(page * pageSize, (page + 1) * pageSize) as entry, offset (keyOf(entry, page * pageSize + offset))}
                        {@const index = page * pageSize + offset}
                        <div class="v-item" data-vkey={keyOf(entry, index)}>
                            {@render item(entry, index)}
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .v-root {
        position: relative;
    }

    .v-container {
        position: relative;
        width: 100%;
    }

    .v-page {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        /* flow-root не даёт margin'ам карточек выпасть из измеряемой высоты */
        display: flow-root;
        will-change: transform;
    }

    .v-item {
        display: block;
    }
</style>
