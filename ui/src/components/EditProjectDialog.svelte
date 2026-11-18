<script lang="ts">
    import { updateProject } from '../lib/api';
    import { app, errorText, loadProjects, notify } from '../lib/state.svelte';
    import type { ProjectSummary } from '../lib/types';
    import { t } from '../lib/i18n.svelte';

    let { project, onclose }: { project: ProjectSummary; onclose: () => void } = $props();
    // svelte-ignore state_referenced_locally
    let title = $state(project.title);
    // svelte-ignore state_referenced_locally
    let roots = $state(project.roots.join('\n'));
    let saving = $state(false);
    let error = $state('');

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!title.trim() || saving) return;
        saving = true;
        error = '';
        try {
            const result = await updateProject(project.key, {
                title: title.trim(),
                roots: roots
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
            });
            app.projects = result.projects;
            await loadProjects();
            notify(t('Проект обновлён', 'Project updated'), 'ok');
            onclose();
        } catch (cause) {
            error = errorText(cause);
        } finally {
            saving = false;
        }
    }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="overlay">
    <button class="backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Изменить проект', 'Edit project')}>
        <form onsubmit={submit}>
            <div class="spread">
                <h2 style="margin: 0; font-size: 16px">{t('Изменить проект', 'Edit project')}</h2>
                <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
            </div>

            <div class="muted small project-edit-key">{project.key}</div>

            <label class="field">
                <span>{t('Название', 'Title')}</span>
                <input bind:value={title} maxlength="120" autocomplete="off" />
            </label>

            <label class="field">
                <span>{t('Корни рабочих копий', 'Working-copy roots')}</span>
                <textarea bind:value={roots} rows="5" placeholder="/path/to/repository&#10;/path/to/another-clone"></textarea>
                <small class="muted">
                    {t(
                        'По одному пути на строку. Пустой список убирает все рабочие копии у проекта.',
                        'One path per line. An empty list removes all working copies from the project.',
                    )}
                </small>
            </label>

            {#if error}<div class="alert error">{error}</div>{/if}

            <div class="row end" style="margin-top: 14px">
                <button class="btn" type="button" onclick={onclose} disabled={saving}>{t('Отмена', 'Cancel')}</button>
                <button class="btn primary" type="submit" disabled={saving || !title.trim()}>{saving ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
            </div>
        </form>
    </div>
</div>
