<script lang="ts">
    import { onMount } from 'svelte';
    import { openReview } from '../lib/api';
    import { app, errorText, notify, writeHash } from '../lib/state.svelte';
    import { t } from '../lib/i18n.svelte';

    let { onclose }: { onclose: () => void } = $props();

    let root = $state('');
    let input = $state('');
    let platform = $state<'auto' | 'gitlab' | 'github'>('auto');
    let project = $state('');
    let host = $state('');
    let branch = $state('');
    let loading = $state(false);
    let error = $state('');
    let inputElement: HTMLInputElement | undefined = $state();

    onMount(() => {
        try {
            root = app.reviews[0]?.root ?? localStorage.getItem('revdeck.root') ?? '';
        } catch {
            root = app.reviews[0]?.root ?? '';
        }
        inputElement?.focus();
    });

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (loading) return;
        if (!root.trim()) {
            error = t('Укажите путь к рабочей копии репозитория', 'Pass the repository working-copy path');
            return;
        }
        if (!input.trim()) {
            error = t('Укажите номер или ссылку на MR/PR', 'Pass an MR/PR number or URL');
            return;
        }
        loading = true;
        error = '';
        try {
            const result = await openReview(root.trim(), input.trim(), {
                ...(platform !== 'auto' ? { platform } : {}),
                ...(project.trim() ? { project: project.trim() } : {}),
                ...(host.trim() ? { host: host.trim() } : {}),
                ...(branch.trim() ? { branch: branch.trim() } : {}),
            });
            try {
                localStorage.setItem('revdeck.root', root.trim());
            } catch {
                // localStorage может быть недоступен.
            }
            app.reviews = result.reviews;
            app.review = result.review;
            app.tab = 'overview';
            app.focus = null;
            app.diffFocus = null;
            writeHash(false);
            notify(t('Ревью открыто', 'Review opened'), 'ok');
            onclose();
        } catch (cause) {
            error = errorText(cause);
        } finally {
            loading = false;
        }
    }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="overlay">
    <button class="backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Открыть ревью', 'Open review')}>
        <form onsubmit={submit}>
        <div class="spread">
            <h2 style="margin: 0; font-size: 16px">{t('Открыть ревью', 'Open review')}</h2>
            <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
        </div>

        <label class="field">
            <span>{t('Номер или ссылка', 'Number or URL')}</span>
            <input bind:this={inputElement} bind:value={input} placeholder="42 · https://gitlab.example.com/group/project/-/merge_requests/42" autocomplete="off" />
        </label>

        <label class="field">
            <span>{t('Корень рабочей копии', 'Working-copy root')}</span>
            <input bind:value={root} placeholder="/path/to/repository" autocomplete="off" />
            <small class="muted">{t('Нужен для чтения .revdeck.yml и правил проекта.', 'Needed to read .revdeck.yml and the project rules.')}</small>
        </label>

        <details>
            <summary class="muted small" style="cursor: pointer">{t('Проект, хост и ветка', 'Project, host and branch')}</summary>
            <div class="stack" style="margin-top: 8px">
                <label class="field">
                    <span>{t('Платформа', 'Platform')}</span>
                    <select bind:value={platform}>
                        <option value="auto">{t('определить автоматически', 'detect automatically')}</option>
                        <option value="gitlab">GitLab</option>
                        <option value="github">GitHub</option>
                    </select>
                </label>
                <label class="field">
                    <span>{t('Проект', 'Project')}</span>
                    <input bind:value={project} placeholder="group/project" autocomplete="off" />
                </label>
                <label class="field">
                    <span>{t('Хост', 'Host')}</span>
                    <input bind:value={host} placeholder="gitlab.example.com" autocomplete="off" />
                </label>
                <label class="field">
                    <span>{t('Ветка для поиска', 'Branch to search')}</span>
                    <input bind:value={branch} placeholder="feature/..." autocomplete="off" />
                </label>
            </div>
        </details>

        {#if error}<div class="alert error">{error}</div>{/if}

        <div class="row end" style="margin-top: 14px">
            <button class="btn" type="button" onclick={onclose} disabled={loading}>{t('Отмена', 'Cancel')}</button>
            <button class="btn primary" type="submit" disabled={loading}>{loading ? t('Открываю…', 'Opening…') : t('Открыть', 'Open')}</button>
        </div>
        </form>
    </div>
</div>
