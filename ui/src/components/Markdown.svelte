<script lang="ts">
    import { renderMarkdown } from '../lib/markdown';

    let { source = '' }: { source?: string } = $props();
    const html = $derived(renderMarkdown(source));
</script>

<div class="md">{@html html}</div>
