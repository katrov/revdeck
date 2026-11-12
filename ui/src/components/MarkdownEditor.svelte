<script lang="ts">
    import { tick } from 'svelte';
    import { t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';
    import AttachmentButton from './AttachmentButton.svelte';

    let {
        value = $bindable(''),
        id,
        placeholder = '',
        rows = 3,
        disabled = false,
        onchange,
    }: {
        value?: string;
        id?: string;
        placeholder?: string;
        rows?: number;
        disabled?: boolean;
        onchange?: () => void;
    } = $props();

    let mode = $state<'write' | 'preview'>('write');
    let textarea = $state<HTMLTextAreaElement | null>(null);

    function changed(): void {
        onchange?.();
    }

    function replaceSelection(prefix: string, suffix = prefix, fallback = ''): void {
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = value.slice(start, end) || fallback;
        value = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
        const cursor = start + prefix.length + selected.length + suffix.length;
        void tick().then(() => {
            textarea?.focus();
            textarea?.setSelectionRange(cursor, cursor);
        });
        changed();
    }

    function insert(text: string): void {
        if (!textarea) {
            value += text;
            changed();
            return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        value = `${value.slice(0, start)}${text}${value.slice(end)}`;
        const cursor = start + text.length;
        void tick().then(() => {
            textarea?.focus();
            textarea?.setSelectionRange(cursor, cursor);
        });
        changed();
    }
</script>

<div class="md-editor" class:disabled>
    <div class="md-editor-head">
        <div class="md-editor-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'write'} class:active={mode === 'write'} onclick={() => (mode = 'write')}>
                {t('Написать', 'Write')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'preview'} class:active={mode === 'preview'} onclick={() => (mode = 'preview')}>
                {t('Просмотр', 'Preview')}
            </button>
        </div>
        {#if mode === 'write' && !disabled}
            <div class="md-editor-tools">
                <button type="button" title={t('Жирный', 'Bold')} aria-label={t('Жирный', 'Bold')} onclick={() => replaceSelection('**', '**', t('текст', 'text'))}>B</button>
                <button type="button" title={t('Курсив', 'Italic')} aria-label={t('Курсив', 'Italic')} onclick={() => replaceSelection('_', '_', t('текст', 'text'))}>I</button>
                <button type="button" title={t('Код', 'Code')} aria-label={t('Код', 'Code')} onclick={() => replaceSelection('`', '`', 'code')}>&lt;/&gt;</button>
                <button type="button" title={t('Ссылка', 'Link')} aria-label={t('Ссылка', 'Link')} onclick={() => replaceSelection('[', '](https://)', t('текст', 'text'))}>🔗</button>
                <button type="button" title={t('Цитата', 'Quote')} aria-label={t('Цитата', 'Quote')} onclick={() => insert('> ')}>❝</button>
                <button type="button" title={t('Список', 'List')} aria-label={t('Список', 'List')} onclick={() => insert('- ')}>•</button>
                <AttachmentButton oninsert={insert} />
            </div>
        {/if}
    </div>
    {#if mode === 'preview'}
        <div class="md-editor-preview">
            {#if value.trim()}
                <Markdown source={value} />
            {:else}
                <span class="muted small">{t('Пока пусто', 'Nothing yet')}</span>
            {/if}
        </div>
    {:else}
        <textarea bind:this={textarea} bind:value {id} {placeholder} {rows} {disabled} oninput={changed}></textarea>
    {/if}
</div>
