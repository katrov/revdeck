<script lang="ts">
    import { uploadAttachment } from '../lib/api';
    import { app, errorText, notify } from '../lib/state.svelte';
    import { t } from '../lib/i18n.svelte';

    let { oninsert, disabled = false }: { oninsert: (markdown: string) => void; disabled?: boolean } = $props();

    const unsupported = $derived(app.review?.info.ref.platform === 'github');
    let input: HTMLInputElement | null = $state(null);
    let busy = $state(false);

    async function picked(event: Event): Promise<void> {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        const review = app.review;
        if (!file || !review) return;
        if (file.size > 25 * 1024 * 1024) {
            notify(t('Файл больше 25 МБ', 'File is larger than 25 MB'), 'error');
            return;
        }
        busy = true;
        try {
            const attachment = await uploadAttachment(review.id, file);
            oninsert(`\n${attachment.markdown}\n`);
            notify(t('Вложение загружено', 'Attachment uploaded'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            busy = false;
        }
    }
</script>

<button
    type="button"
    class="btn"
    disabled={disabled || busy || unsupported || !app.review}
    title={unsupported
        ? t('GitHub не поддерживает загрузку вложений: вставьте абсолютную ссылку', 'GitHub does not support attachment uploads: paste an absolute URL')
        : t('Картинка или видео: ссылка появится в тексте', 'Image or video: the link is inserted into the text')}
    onclick={() => input?.click()}
>
    {busy ? t('Загрузка…', 'Uploading…') : t('Прикрепить', 'Attach')}
</button>
<input
    bind:this={input}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/ogg,video/quicktime"
    hidden
    onchange={picked}
/>
