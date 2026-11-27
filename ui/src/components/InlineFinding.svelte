<script lang="ts">
    import { focusFinding } from '../lib/state.svelte';
    import type { Finding } from '../lib/types';
    import { t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';

    let { finding }: { finding: Finding } = $props();

    const LEVEL_ICON: Record<Finding['level'], string> = { blocker: '🟥', major: '🟧', minor: '🟨', question: '🟦' };

    function statusLabel(status: Finding['status']): string {
        switch (status) {
            case 'draft':
                return t('черновик', 'draft');
            case 'accepted':
                return t('принято', 'accepted');
            case 'rejected':
                return t('отклонено', 'rejected');
            case 'published':
                return t('опубликовано', 'published');
            case 'fixed':
                return t('исправлено', 'fixed');
            case 'stale':
                return t('устарело', 'stale');
        }
    }
</script>

<section class="inline-card inline-finding">
    <div class="inline-card-head">
        <span class="badge {finding.level}" title={finding.level}>{LEVEL_ICON[finding.level]} {finding.level}</span>
        <span class="badge">{statusLabel(finding.status)}</span>
        <strong class="inline-title">{finding.title}</strong>
        <div class="grow"></div>
        <button class="btn" type="button" onclick={() => focusFinding(finding.id)}>{t('Открыть', 'Open')}</button>
    </div>
    {#if finding.body}
        <div class="md"><Markdown source={finding.body} /></div>
    {/if}
</section>
