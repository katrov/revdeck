<script lang="ts">
    import { tick } from 'svelte';
    import { uploadAttachment } from '../lib/api';
    import { app, errorText, notify } from '../lib/state.svelte';
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
    let uploading = $state(0);

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

    async function uploadFiles(files: FileList | File[] | null | undefined): Promise<void> {
        const review = app.review;
        if (!files || !review) return;
        const list = Array.from(files).filter((file) => file.size > 0);
        if (!list.length) return;
        uploading += list.length;
        try {
            for (const file of list) {
                try {
                    const attachment = await uploadAttachment(review.id, file);
                    insert(`\n${attachment.markdown}\n`);
                } catch (error) {
                    notify(errorText(error), 'error');
                } finally {
                    uploading -= 1;
                }
            }
        } finally {
            uploading = Math.max(0, uploading);
        }
    }

    function handlePaste(event: ClipboardEvent): void {
        const files = event.clipboardData?.files;
        if (files?.length) {
            event.preventDefault();
            void uploadFiles(files);
        }
    }

    function handleDrop(event: DragEvent): void {
        const files = event.dataTransfer?.files;
        if (files?.length) {
            event.preventDefault();
            event.stopPropagation();
            void uploadFiles(files);
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key === 'b') {
            event.preventDefault();
            replaceSelection('**', '**', t('текст', 'text'));
        } else if (key === 'i') {
            event.preventDefault();
            replaceSelection('_', '_', t('текст', 'text'));
        } else if (key === 'k') {
            event.preventDefault();
            replaceSelection('[', '](https://)', t('текст', 'text'));
        }
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

<div class="md-editor" class:disabled role="group" aria-label={t('Редактор markdown', 'Markdown editor')} ondrop={handleDrop} ondragover={(event) => event.preventDefault()}>
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
                {#if uploading}<span class="muted small">{t('Загрузка…', 'Uploading…')}</span>{/if}
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
        <textarea
            bind:this={textarea}
            bind:value
            {id}
            {placeholder}
            {rows}
            {disabled}
            oninput={changed}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
            ondrop={handleDrop}
            ondragover={(event) => event.preventDefault()}
        ></textarea>
    {/if}
</div>
