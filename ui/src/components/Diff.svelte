<script lang="ts">
    import { onMount } from 'svelte';
    import { app, copyFocusLink, errorText, focusNote, notify } from '../lib/state.svelte';
    import { addNote, deleteNote, getDiff, getFileContent, updateNote } from '../lib/api';
    import type { DiffLine, DiffPayload, FileContentPayload, FileSummary } from '../lib/types';
    import { truncate } from '../lib/format';
    import { plural, t } from '../lib/i18n.svelte';
    import MarkdownEditor from './MarkdownEditor.svelte';
    import Markdown from './Markdown.svelte';

    const TREE_WIDTH_KEY = 'revdeck.diff.treeWidth';
    const TREE_HIDDEN_KEY = 'revdeck.diff.treeHidden';
    const TREE_MIN = 220;
    const TREE_MAX = 760;
    const DIFF_MIN = 360;
    const TREE_DEFAULT = 300;
    const GAP_STEP = 10;
    const PAGE_LINES = 2600;

    interface DirBucket {
        name: string;
        path: string;
        dirs: Map<string, DirBucket>;
        files: FileSummary[];
    }
    type TreeRow =
        | { kind: 'dir'; name: string; path: string; depth: number; count: number }
        | { kind: 'file'; item: FileSummary; depth: number };

    interface DiffGap {
        key: string;
        oldStart: number;
        oldCount: number;
        newStart: number;
        newCount: number;
    }
    type Row = { kind: 'hunk'; header: string } | { kind: 'line'; line: DiffLine } | { kind: 'gap'; gap: DiffGap };

    function storedWidth(): number {
        try {
            const raw = localStorage.getItem(TREE_WIDTH_KEY);
            const value = raw ? Number(raw) : Number.NaN;
            if (!Number.isFinite(value)) return TREE_DEFAULT;
            return Math.max(TREE_MIN, Math.min(TREE_MAX, Math.round(value)));
        } catch {
            return TREE_DEFAULT;
        }
    }

    function storedTreeHidden(): boolean {
        try {
            return localStorage.getItem(TREE_HIDDEN_KEY) === '1';
        } catch {
            return false;
        }
    }

    let diff = $state<DiffPayload | null>(null);
    let loading = $state(false);
    let error = $state('');
    let limit = $state(PAGE_LINES);
    let noteTarget = $state<{ line: number } | null>(null);
    let noteText = $state('');
    let savingNote = $state(false);
    let fileQuery = $state('');
    let hideViewed = $state(false);
    let viewed = $state<Record<string, boolean>>({});
    let editingNote = $state<string | null>(null);
    let editNoteText = $state('');
    let editingAgent = $state<string | null>(null);
    let editAgentText = $state('');
    let noteBusy = $state<string | null>(null);

    let splitEl = $state<HTMLDivElement | null>(null);
    let treeWidth = $state(storedWidth());
    let treeHidden = $state(storedTreeHidden());
    let resizing = $state(false);
    let resizeStartX = 0;
    let resizeStartWidth = 0;
    let collapsedDirs = $state<Record<string, boolean>>({});
    let autoExpandedFile: string | null = null;

    let fileContent = $state<FileContentPayload | null>(null);
    let contentLoading = $state(false);
    let contentError = $state('');
    let contentRequest = 0;
    let diffRequest = 0;
    let expandedGaps = $state<Record<string, { top: number; bottom: number }>>({});

    const file = $derived(app.diffFile);
    const files = $derived(
        (app.review?.files ?? []).filter((item) => {
            if (fileQuery.trim() && !item.path.toLowerCase().includes(fileQuery.trim().toLowerCase())) return false;
            if (hideViewed && viewed[item.path]) return false;
            return true;
        }),
    );
    const currentIndex = $derived(files.findIndex((item) => item.path === file));
    const viewedCount = $derived(Object.values(viewed).filter(Boolean).length);

    const treeRows = $derived.by(() => {
        const root: DirBucket = { name: '', path: '', dirs: new Map(), files: [] };
        for (const item of files) {
            const parts = item.path.split('/');
            let node = root;
            for (let index = 0; index < parts.length - 1; index += 1) {
                const name = parts[index]!;
                const dirPath = parts.slice(0, index + 1).join('/');
                let next = node.dirs.get(name);
                if (!next) {
                    next = { name, path: dirPath, dirs: new Map(), files: [] };
                    node.dirs.set(name, next);
                }
                node = next;
            }
            node.files.push(item);
        }
        const countFiles = (node: DirBucket): number => {
            let count = node.files.length;
            for (const dir of node.dirs.values()) count += countFiles(dir);
            return count;
        };
        const out: TreeRow[] = [];
        const forceOpen = fileQuery.trim().length > 0;
        const walk = (node: DirBucket, depth: number): void => {
            const dirs = [...node.dirs.values()].sort((left, right) => left.name.localeCompare(right.name));
            for (const dir of dirs) {
                out.push({ kind: 'dir', name: dir.name, path: dir.path, depth, count: countFiles(dir) });
                if (forceOpen || !collapsedDirs[dir.path]) walk(dir, depth + 1);
            }
            const sorted = node.files.slice().sort((left, right) => left.path.localeCompare(right.path));
            for (const item of sorted) out.push({ kind: 'file', item, depth });
        };
        walk(root, 0);
        return out;
    });

    const gapSide = $derived(fileContent?.side ?? (diff?.status === 'deleted' ? 'base' : 'head'));

    const gaps = $derived.by(() => {
        const out: DiffGap[] = [];
        if (!diff || !diff.hunks.length) return out;
        const side = gapSide;
        const first = diff.hunks[0]!;
        const topOld = Math.max(0, first.oldStart - 1);
        const topNew = Math.max(0, first.newStart - 1);
        if ((side === 'base' ? topOld : topNew) > 0) {
            out.push({ key: 'top', oldStart: 1, oldCount: topOld, newStart: 1, newCount: topNew });
        }
        for (let index = 0; index < diff.hunks.length - 1; index += 1) {
            const hunk = diff.hunks[index]!;
            const next = diff.hunks[index + 1]!;
            const oldStart = hunk.oldStart + hunk.oldLines;
            const newStart = hunk.newStart + hunk.newLines;
            const oldCount = Math.max(0, next.oldStart - oldStart);
            const newCount = Math.max(0, next.newStart - newStart);
            if ((side === 'base' ? oldCount : newCount) > 0) {
                out.push({ key: `gap-${index}`, oldStart, oldCount, newStart, newCount });
            }
        }
        if (fileContent) {
            const last = diff.hunks[diff.hunks.length - 1]!;
            const oldStart = last.oldStart + last.oldLines;
            const newStart = last.newStart + last.newLines;
            const total = fileContent.lines.length;
            const oldCount = Math.max(0, total - oldStart + 1);
            const newCount = Math.max(0, total - newStart + 1);
            if ((side === 'base' ? oldCount : newCount) > 0) {
                out.push({ key: 'tail', oldStart, oldCount, newStart, newCount });
            }
        }
        return out;
    });

    function gapTotal(gap: DiffGap): number {
        return gapSide === 'base' ? gap.oldCount : gap.newCount;
    }

    function gapLine(gap: DiffGap, index: number): DiffLine {
        if (!fileContent) return { kind: ' ', text: '', oldLine: null, newLine: null };
        if (fileContent.side === 'base') {
            const oldLine = gap.oldStart + index;
            return { kind: ' ', text: fileContent.lines[oldLine - 1] ?? '', oldLine, newLine: null };
        }
        const newLine = gap.newStart + index;
        return { kind: ' ', text: fileContent.lines[newLine - 1] ?? '', oldLine: gap.oldStart + index, newLine };
    }

    const rows = $derived.by(() => {
        const out: Row[] = [];
        if (!diff) return out;
        const gapMap = new Map(gaps.map((gap) => [gap.key, gap]));
        const pushGap = (gap: DiffGap): void => {
            const total = gapTotal(gap);
            const state = expandedGaps[gap.key] ?? { top: 0, bottom: 0 };
            const top = Math.min(state.top, total);
            const bottom = Math.min(state.bottom, Math.max(0, total - top));
            const remaining = total - top - bottom;
            for (let index = 0; index < top; index += 1) out.push({ kind: 'line', line: gapLine(gap, index) });
            if (remaining > 0) out.push({ kind: 'gap', gap });
            for (let index = total - bottom; index < total; index += 1) out.push({ kind: 'line', line: gapLine(gap, index) });
        };
        const topGap = gapMap.get('top');
        if (topGap) pushGap(topGap);
        for (let index = 0; index < diff.hunks.length; index += 1) {
            const hunk = diff.hunks[index]!;
            out.push({ kind: 'hunk', header: hunk.header });
            for (const line of hunk.lines) out.push({ kind: 'line', line });
            const between = gapMap.get(`gap-${index}`);
            if (between) pushGap(between);
        }
        const tail = gapMap.get('tail');
        if (tail) pushGap(tail);
        return out;
    });

    /** Ключ кэша раскрытых участков не должен переезжать между файлами. */
    $effect(() => {
        const id = app.review?.id;
        if (!id) return;
        try {
            const stored = JSON.parse(localStorage.getItem(`revdeck.viewed.${id}`) ?? '{}') as unknown;
            viewed = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, boolean>) : {};
        } catch {
            viewed = {};
        }
    });

    $effect(() => {
        if (!files.some((item) => item.path === app.diffFile)) app.diffFile = files[0]?.path ?? null;
    });

    $effect(() => {
        const reviewId = app.review?.id;
        const path = app.diffFile;
        const request = ++diffRequest;
        fileContent = null;
        contentError = '';
        expandedGaps = {};
        limit = PAGE_LINES;
        if (!reviewId || !path) {
            diff = null;
            loading = false;
            error = '';
            return;
        }
        diff = null;
        loading = true;
        error = '';
        void getDiff(reviewId, path)
            .then((data) => {
                if (request === diffRequest) diff = data.file;
            })
            .catch((cause) => {
                if (request !== diffRequest) return;
                error = errorText(cause);
                diff = null;
            })
            .finally(() => {
                if (request === diffRequest) loading = false;
            });
    });

    async function loadContent(reviewId: string, path: string): Promise<void> {
        const request = ++contentRequest;
        contentLoading = true;
        contentError = '';
        try {
            const data = await getFileContent(reviewId, path);
            if (request === contentRequest) fileContent = data.file;
        } catch (cause) {
            if (request !== contentRequest) return;
            contentError = errorText(cause);
            fileContent = null;
        } finally {
            if (request === contentRequest) contentLoading = false;
        }
    }

    $effect(() => {
        const reviewId = app.review?.id;
        const target = diff;
        if (!reviewId || !target || target.binary) {
            contentRequest += 1;
            fileContent = null;
            contentError = '';
            contentLoading = false;
            return;
        }
        void loadContent(reviewId, target.path);
    });

    $effect(() => {
        const path = app.diffFile;
        if (!path || path === autoExpandedFile) return;
        autoExpandedFile = path;
        const parts = path.split('/');
        const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
        if (!parents.some((parent) => collapsedDirs[parent])) return;
        const next = { ...collapsedDirs };
        for (const parent of parents) delete next[parent];
        collapsedDirs = next;
    });

    function clampWidth(value: number): number {
        const available = splitEl?.getBoundingClientRect().width ?? window.innerWidth - 320;
        const upper = Math.max(TREE_MIN, Math.min(TREE_MAX, available - DIFF_MIN));
        return Math.round(Math.max(TREE_MIN, Math.min(upper, value)));
    }

    function saveTreeWidth(): void {
        try {
            localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth));
        } catch {
            // localStorage может быть недоступен.
        }
    }

    function setTreeHidden(hidden: boolean): void {
        treeHidden = hidden;
        try {
            localStorage.setItem(TREE_HIDDEN_KEY, hidden ? '1' : '0');
        } catch {
            // localStorage может быть недоступен.
        }
    }

    function beginResize(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        resizing = true;
        resizeStartX = event.clientX;
        resizeStartWidth = treeWidth;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    function moveResize(event: PointerEvent): void {
        if (!resizing) return;
        treeWidth = clampWidth(resizeStartWidth + event.clientX - resizeStartX);
    }

    function endResize(event: PointerEvent): void {
        if (!resizing) return;
        resizing = false;
        const element = event.currentTarget as HTMLElement;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        saveTreeWidth();
    }

    function resizeKeydown(event: KeyboardEvent): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        treeWidth = clampWidth(treeWidth + (event.key === 'ArrowRight' ? 24 : -24));
        saveTreeWidth();
    }

    onMount(() => {
        const onWindowResize = (): void => {
            if (window.innerWidth > 860) treeWidth = clampWidth(treeWidth);
        };
        window.addEventListener('resize', onWindowResize);
        return () => window.removeEventListener('resize', onWindowResize);
    });

    function toggleDir(path: string): void {
        collapsedDirs = { ...collapsedDirs, [path]: !collapsedDirs[path] };
    }

    function expandGap(gap: DiffGap, mode: 'top' | 'bottom' | 'all'): void {
        if (!fileContent) return;
        const total = gapTotal(gap);
        const current = expandedGaps[gap.key] ?? { top: 0, bottom: 0 };
        let next: { top: number; bottom: number };
        if (mode === 'all') {
            next = { top: total, bottom: 0 };
        } else if (mode === 'top') {
            next = { top: Math.min(total - current.bottom, current.top + GAP_STEP), bottom: current.bottom };
        } else {
            next = { top: current.top, bottom: Math.min(total - current.top, current.bottom + GAP_STEP) };
        }
        expandedGaps = { ...expandedGaps, [gap.key]: next };
    }

    function retryContent(): void {
        const reviewId = app.review?.id;
        const path = diff?.path;
        if (reviewId && path) void loadContent(reviewId, path);
    }

    function toggleViewed(path: string, value: boolean): void {
        viewed = { ...viewed, [path]: value };
        const id = app.review?.id;
        if (id) {
            try {
                localStorage.setItem(`revdeck.viewed.${id}`, JSON.stringify(viewed));
            } catch {
                // localStorage может быть недоступен.
            }
        }
    }

    function copyPath(file: string, line: number): void {
        void navigator.clipboard?.writeText(`${file}:${line}`).then(
            () => notify(t('Путь скопирован', 'Path copied'), 'ok'),
            () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
        );
    }

    function startNoteEdit(note: { id: string; text: string }): void {
        editingNote = note.id;
        editNoteText = note.text;
    }

    function startAgentEdit(note: { id: string; agentReply: string }): void {
        editingAgent = note.id;
        editAgentText = note.agentReply;
    }

    async function saveAgentEdit(note: { id: string; agentReply: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        noteBusy = note.id;
        try {
            await updateNote(review.id, note.id, { agentReply: editAgentText });
            note.agentReply = editAgentText;
            editingAgent = null;
            notify(t('Ответ агента обновлён', 'Agent reply updated'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    async function saveNoteEdit(note: { id: string; text: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        noteBusy = note.id;
        try {
            await updateNote(review.id, note.id, { text: editNoteText });
            note.text = editNoteText;
            editingNote = null;
            notify(t('Комментарий обновлён', 'Comment updated'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    async function removeNote(note: { id: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        if (!confirm(t('Удалить комментарий?', 'Delete the comment?'))) return;
        noteBusy = note.id;
        try {
            await deleteNote(review.id, note.id);
            review.notes = review.notes.filter((item) => item.id !== note.id);
            notify(t('Комментарий удалён', 'Comment deleted'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    function selectRelative(delta: number): void {
        if (!files.length) return;
        const index = currentIndex >= 0 ? currentIndex : 0;
        const next = Math.max(0, Math.min(files.length - 1, index + delta));
        app.diffFile = files[next]!.path;
    }

    const marks = $derived.by(() => {
        const map = new Map<number, string[]>();
        const review = app.review;
        if (!review || !diff) return map;
        for (const finding of review.findings) {
            if (finding.file === diff.path && finding.line) {
                map.set(finding.line, [...(map.get(finding.line) ?? []), `${t('замечание', 'finding')} ${finding.id}`]);
            }
        }
        for (const thread of review.threads) {
            if (thread.path === diff.path && thread.line && !thread.resolved) {
                map.set(thread.line, [...(map.get(thread.line) ?? []), t('открытый тред', 'open thread')]);
            }
        }
        for (const note of review.notes) {
            if (note.file === diff.path && note.line) {
                map.set(note.line, [...(map.get(note.line) ?? []), t('комментарий к строке', 'line comment')]);
            }
        }
        return map;
    });

    const fileNotes = $derived((app.review?.notes ?? []).filter((note) => note.file === file));

    function pickLine(lineNumber: number | null): void {
        if (!lineNumber || app.preview) return;
        noteTarget = { line: lineNumber };
        noteText = '';
    }

    async function submitNote(): Promise<void> {
        const review = app.review;
        if (!review || !file || !noteTarget) return;
        if (!noteText.trim()) return;
        savingNote = true;
        try {
            const result = await addNote(review.id, file, noteTarget.line, noteText.trim());
            review.notes = [...review.notes, result.note];
            notify(t('Комментарий сохранён: агент увидит его в контексте', 'Comment saved: the agent sees it in the review context'), 'ok');
            noteTarget = null;
            noteText = '';
        } catch (cause) {
            notify(errorText(cause), 'error');
        } finally {
            savingNote = false;
        }
    }

    $effect(() => {
        const focus = app.diffFocus;
        if (!focus || !diff || focus.file !== diff.path) return;
        requestAnimationFrame(() => {
            document.getElementById(`line-${focus.line}`)?.scrollIntoView({ block: 'center' });
        });
    });

    $effect(() => {
        const focus = app.focus;
        if (focus?.kind !== 'note') return;
        requestAnimationFrame(() => document.getElementById(`note-${focus.id}`)?.scrollIntoView({ block: 'center' }));
    });
</script>

<div class="split" bind:this={splitEl} class:resizing style:--file-tree-width={`${treeWidth}px`}>
    {#if !treeHidden}
        <div class="file-list" aria-label={t('Файлы ревью', 'Review files')}>
            <div class="file-tools">
                <div class="spread">
                    <span class="file-tree-title">{t('Файлы', 'Files')} <span class="muted">{files.length}</span></span>
                    <button
                        class="btn icon"
                        type="button"
                        title={t('Скрыть дерево файлов', 'Hide file tree')}
                        aria-label={t('Скрыть дерево файлов', 'Hide file tree')}
                        onclick={() => setTreeHidden(true)}
                    >«</button>
                </div>
                <input bind:value={fileQuery} placeholder={t('Найти файл…', 'Filter files…')} aria-label={t('Найти файл', 'Filter files')} />
                <div class="spread">
                    <label class="switch small">
                        <input type="checkbox" bind:checked={hideViewed} style="width: auto" />
                        {t('Скрыть просмотренные', 'Hide viewed')}
                    </label>
                    <span class="muted small">{viewedCount}/{app.review?.files.length ?? 0}</span>
                </div>
                <div class="file-nav">
                    <button class="btn icon" type="button" onclick={() => selectRelative(-1)} disabled={currentIndex <= 0} title={t('Предыдущий файл', 'Previous file')}>←</button>
                    <span class="muted small">{files.length ? `${currentIndex + 1}/${files.length}` : '0/0'}</span>
                    <button class="btn icon" type="button" onclick={() => selectRelative(1)} disabled={currentIndex < 0 || currentIndex >= files.length - 1} title={t('Следующий файл', 'Next file')}>→</button>
                </div>
            </div>
            {#each treeRows as row (row.kind === 'dir' ? `dir:${row.path}` : `file:${row.item.path}`)}
                {#if row.kind === 'dir'}
                    {@const open = fileQuery.trim().length > 0 || !collapsedDirs[row.path]}
                    <button
                        class="tree-dir"
                        type="button"
                        style:padding-left={`${6 + row.depth * 12}px`}
                        aria-expanded={open}
                        onclick={() => toggleDir(row.path)}
                    >
                        <span class="tree-chev">{open ? '▾' : '▸'}</span>
                        <span class="tree-name" title={row.path}>{row.name}/</span>
                        <span class="tree-count">{row.count}</span>
                    </button>
                {:else}
                    {@const name = row.item.path.slice(row.item.path.lastIndexOf('/') + 1)}
                    <div class="file-row" class:active={app.diffFile === row.item.path} style:padding-left={`${row.depth * 12}px`}>
                        <input
                            type="checkbox"
                            class="file-check"
                            checked={viewed[row.item.path] ?? false}
                            aria-label={t('Файл просмотрен', 'File viewed')}
                            onchange={(event) => toggleViewed(row.item.path, event.currentTarget.checked)}
                        />
                        <button
                            class="file-item"
                            class:active={app.diffFile === row.item.path}
                            title={row.item.path}
                            onclick={() => (app.diffFile = row.item.path)}
                        >
                            {#if row.item.status === 'added'}<span class="badge ok">A</span>{:else if row.item.status === 'deleted'}<span class="badge err">D</span>{:else if row.item.status === 'renamed'}<span class="badge">R</span>{:else}<span class="badge">M</span>{/if}
                            <span class="name">{name}</span>
                            <span class="counts">{row.item.additions}/{row.item.deletions}</span>
                        </button>
                    </div>
                {/if}
            {:else}
                <p class="muted small" style="padding: 8px">{t('Файлов не найдено.', 'No files found.')}</p>
            {/each}
        </div>
        <button
            class="resizer"
            type="button"
            class:dragging={resizing}
            aria-label={t('Изменить ширину списка файлов', 'Resize the file list')}
            title={t('Потяните, чтобы изменить ширину; двойной клик — сброс', 'Drag to resize; double-click to reset')}
            onpointerdown={beginResize}
            onpointermove={moveResize}
            onpointerup={endResize}
            onpointercancel={endResize}
            ondblclick={() => {
                treeWidth = TREE_DEFAULT;
                saveTreeWidth();
            }}
            onkeydown={resizeKeydown}
        ></button>
    {:else}
        <button
            class="file-rail"
            type="button"
            title={t('Показать дерево файлов', 'Show file tree')}
            aria-label={t('Показать дерево файлов', 'Show file tree')}
            onclick={() => setTreeHidden(false)}
        >
            <span class="rail-icon">☰</span>
            <span class="rail-count">{files.length}</span>
        </button>
    {/if}

    <div class="diff-view">
        {#if loading && !diff}
            <p class="muted" style="padding: 12px">{t('Загрузка diff…', 'Loading diff…')}</p>
        {:else if error}
            <div class="alert error" style="margin: 12px">{error}</div>
        {:else if !diff}
            <p class="muted" style="padding: 12px">{t('Выберите файл слева.', 'Pick a file on the left.')}</p>
        {:else if diff.binary}
            <p class="muted" style="padding: 12px">{t('Бинарный файл: diff не отображается.', 'Binary file: no diff to display.')}</p>
        {:else}
            <div class="diff-content">
                {#each rows.slice(0, limit) as row}
                    {#if row.kind === 'hunk'}
                        <div class="hunk-head">{row.header}</div>
                    {:else if row.kind === 'gap'}
                        {@const gap = row.gap}
                        {@const total = gapTotal(gap)}
                        {@const state = expandedGaps[gap.key] ?? { top: 0, bottom: 0 }}
                        {@const remaining = Math.max(0, total - state.top - state.bottom)}
                        <div class="diff-gap">
                            <button
                                class="gap-step"
                                type="button"
                                title={t('Раскрыть 10 строк сверху', 'Expand 10 more lines above')}
                                aria-label={t('Раскрыть строки сверху', 'Expand lines above')}
                                disabled={!fileContent || state.top >= total - state.bottom}
                                onclick={() => expandGap(gap, 'top')}
                            >↓</button>
                            <button
                                class="gap-all"
                                type="button"
                                title={contentError ? contentError : fileContent ? t('Показать все скрытые строки', 'Show all hidden lines') : t('Показать скрытые строки', 'Show hidden lines')}
                                disabled={!contentError && !fileContent && contentLoading}
                                onclick={() => (contentError ? retryContent() : expandGap(gap, 'all'))}
                            >
                                {#if contentError}
                                    {t('Скрытые строки недоступны — повторить', 'Hidden lines unavailable — retry')}
                                {:else if !fileContent}
                                    {contentLoading ? t('Загрузка скрытых строк…', 'Loading hidden lines…') : t('Показать скрытые строки', 'Show hidden lines')}
                                {:else}
                                    {remaining} {plural(remaining, ['скрытая строка', 'скрытые строки', 'скрытых строк'], ['hidden line', 'hidden lines'])} · {t('показать все', 'show all')}
                                {/if}
                            </button>
                            <button
                                class="gap-step"
                                type="button"
                                title={t('Раскрыть 10 строк снизу', 'Expand 10 more lines below')}
                                aria-label={t('Раскрыть строки снизу', 'Expand lines below')}
                                disabled={!fileContent || state.bottom >= total - state.top}
                                onclick={() => expandGap(gap, 'bottom')}
                            >↑</button>
                        </div>
                    {:else}
                        {@const line = row.line}
                        {@const number = line.newLine ?? line.oldLine ?? 0}
                        <div
                            class="diff-line"
                            class:add={line.kind === '+'}
                            class:del={line.kind === '-'}
                            class:target-line={app.diffFocus?.line === number && app.diffFocus?.file === diff.path}
                            id={`line-${number}`}
                            onclick={() => pickLine(line.newLine)}
                            onkeydown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    pickLine(line.newLine);
                                }
                            }}
                            role="button"
                            tabindex="0"
                            title={marks.get(number)?.join(', ') ?? ''}
                        >
                            <span class="n">{line.newLine ?? ''}</span>
                            <span class="n">{line.oldLine ?? ''}</span>
                            <span class="k">{line.kind === ' ' ? '' : line.kind}</span>
                            <span class="text">
                                {line.text}{#if marks.has(number)}<span class="badge minor" style="margin-left: 8px">{truncate(marks.get(number)!.join(', '), 40)}</span>{/if}
                            </span>
                        </div>
                    {/if}
                {/each}
            </div>
            {#if rows.length > limit}
                <div style="padding: 12px">
                    <button class="btn" onclick={() => (limit += PAGE_LINES)}>{t('Показать ещё', 'Show more')} ({rows.length - limit} {t('строк', 'lines')})</button>
                </div>
            {/if}

            {#if fileContent?.truncated}
                <p class="muted small" style="padding: 0 12px">{t('Файл очень большой: раскрытие ограничено первыми 20 000 строками.', 'The file is very large: expansion is limited to the first 20,000 lines.')}</p>
            {/if}

            {#if noteTarget && !app.preview}
                <div class="note-composer">
                    <div class="spread" style="margin-bottom: 6px">
                        <strong>{t('Комментарий к строке', 'Comment on line')} {noteTarget.line}</strong>
                        <button class="btn" onclick={() => (noteTarget = null)}>{t('Отмена', 'Cancel')}</button>
                    </div>
                    <MarkdownEditor
                        bind:value={noteText}
                        rows={2}
                        placeholder={t('Комментарий уйдёт агенту', 'The comment goes to the agent')}
                    />
                    <div class="row end" style="margin-top: 6px">
                        <span class="muted small">{t('Агент увидит комментарий в контексте ревью.', 'The agent sees this comment in the review context.')}</span>
                        <button class="btn icon" type="button" title={t('Скопировать ссылку на строку', 'Copy line link')} onclick={() => copyFocusLink({ kind: 'line', file: file ?? '', line: noteTarget?.line ?? 0 }, 'diff')}>🔗</button>
                        <button class="btn primary" onclick={() => void submitNote()} disabled={savingNote || !noteText.trim()}>{t('Сохранить', 'Save')}</button>
                    </div>
                </div>
            {/if}

            {#if fileNotes.length}
                <div style="padding: 12px">
                    <div class="section-title">{t('Комментарии к строкам этого файла', 'Line comments in this file')}</div>
                    {#each fileNotes as note (note.id)}
                        <section class="card flat" id={`note-${note.id}`} class:highlight={app.focus?.kind === 'note' && app.focus.id === note.id}>
                            <div class="card-head">
                                <span class="note-location">
                                    <button class="path-link" type="button" title={`${note.file}:${note.line}`} onclick={() => focusNote(note)}>{note.file}:{note.line}</button>
                                    <button class="btn icon" type="button" title={t('Скопировать путь', 'Copy path')} aria-label={t('Скопировать путь', 'Copy path')} onclick={() => copyPath(note.file, note.line)}>⧉</button>
                                </span>
                                <button class="btn icon" type="button" title={t('Скопировать ссылку на комментарий', 'Copy comment link')} onclick={() => copyFocusLink({ kind: 'note', id: note.id }, 'diff')}>🔗</button>
                                {#if !app.preview && !note.posted && editingNote !== note.id}
                                    <button class="btn icon" type="button" title={t('Редактировать', 'Edit')} disabled={noteBusy !== null} onclick={() => startNoteEdit(note)}>✎</button>
                                    <button class="btn icon" type="button" title={t('Удалить', 'Delete')} disabled={noteBusy !== null} onclick={() => void removeNote(note)}>🗑</button>
                                {/if}
                                {#if note.posted}<span class="badge ok">{t('опубликовано', 'published')}</span>{/if}
                                {#if note.agentReply}<span class="badge">{t('ответ агента', 'agent reply')}</span>{/if}
                                {#if !app.preview && note.agentReply && editingAgent !== note.id}
                                    <button class="btn icon" type="button" title={t('Редактировать ответ агента', 'Edit agent reply')} disabled={noteBusy !== null} onclick={() => startAgentEdit(note)}>✎</button>
                                {/if}
                            </div>
                            {#if editingNote === note.id}
                                <MarkdownEditor bind:value={editNoteText} rows={2} />
                                <div class="row end" style="margin-top: 4px">
                                    <button class="btn" type="button" onclick={() => (editingNote = null)}>{t('Отмена', 'Cancel')}</button>
                                    <button class="btn primary" type="button" disabled={noteBusy !== null} onclick={() => void saveNoteEdit(note)}>{noteBusy ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
                                </div>
                            {:else}
                                <div class="md"><Markdown source={note.text} /></div>
                            {/if}
                            {#if editingAgent === note.id}
                                <MarkdownEditor bind:value={editAgentText} rows={2} />
                                <div class="row end" style="margin-top: 4px">
                                    <button class="btn" type="button" onclick={() => (editingAgent = null)}>{t('Отмена', 'Cancel')}</button>
                                    <button class="btn primary" type="button" disabled={noteBusy !== null} onclick={() => void saveAgentEdit(note)}>{noteBusy ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
                                </div>
                            {:else if note.agentReply}
                                <div class="muted small">→ {note.agentReply}</div>
                            {/if}
                            {#if note.error}<div class="alert error">{note.error}</div>{/if}
                        </section>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>
