<script lang="ts">
    import { app } from '../lib/state.svelte';
    import { renderMarkdown } from '../lib/markdown';

    let { source = '' }: { source?: string } = $props();

    const baseUrl = $derived.by(() => {
        const webUrl = app.review?.info.webUrl;
        if (webUrl) {
            try {
                const parsed = new URL(webUrl);
                return `${parsed.protocol}//${parsed.host}`;
            } catch {
                // ниже — запасной вариант по host
            }
        }
        return app.review ? `https://${app.review.info.ref.host}` : '';
    });
    const uploadsBaseUrl = $derived.by(() => {
        const review = app.review;
        if (!review || review.info.ref.platform !== 'gitlab' || !review.info.projectId) return baseUrl;
        return `${baseUrl}/-/project/${review.info.projectId}`;
    });
    const html = $derived(renderMarkdown(source, { baseUrl, uploadsBaseUrl }));
</script>

<div class="md">{@html html}</div>
