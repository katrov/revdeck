<script lang="ts">
    import { onMount } from 'svelte';
    import { registerProject } from '../lib/api';
    import { app, errorText, loadFeatures, loadProjects, loadReviews, notify, showProjectsHome } from '../lib/state.svelte';
    import { t } from '../lib/i18n.svelte';

    let { onclose }: { onclose: () => void } = $props();
    let root = $state('');
    let saving = $state(false);
    let error = $state('');
    let input: HTMLInputElement | undefined = $state();

    onMount(() => {
        root =
            app.projects.find((project) => project.key === app.activeProject)?.roots[0] ??
            (() => {
                try {
                    return localStorage.getItem('revdeck.root') ?? '';
                } catch {
                    return '';
                }
            })();
        input?.focus();
    });

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (saving) return;
        if (!root.trim()) {
            error = t('Укажите путь к рабочей копии репозитория', 'Pass the repository working-copy path');
            return;
        }
        saving = true;
        error = '';
        const stayOnProjectsHome = app.projectsHome || !app.projects.length;
        try {
            const result = await registerProject(root.trim());
            if (!result.project) {
                error = t(
                    'Не удалось определить проект: проверьте git remote и .revdeck.yml',
                    'Could not determine the project: check the git remote and .revdeck.yml',
                );
                return;
            }
            app.projects = result.projects;
            await loadProjects();
            await loadReviews();
            await loadFeatures();
            if (stayOnProjectsHome) showProjectsHome(false);
            try {
                localStorage.setItem('revdeck.root', root.trim());
            } catch {
                // localStorage может быть недоступен.
            }
            notify(t(`Проект добавлен: ${result.project.title}`, `Project added: ${result.project.title}`), 'ok');
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Добавить проект', 'Add project')}>
        <form onsubmit={submit}>
            <div class="spread">
                <h2 style="margin: 0; font-size: 16px">{t('Добавить проект', 'Add project')}</h2>
                <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
            </div>

            <label class="field">
                <span>{t('Корень рабочей копии', 'Working-copy root')}</span>
                <input bind:this={input} bind:value={root} placeholder="/path/to/repository" autocomplete="off" />
                <small class="muted">
                    {t(
                        'revdeck прочитает git remote и .revdeck.yml, чтобы определить платформу, хост и проект.',
                        'revdeck reads the git remote and .revdeck.yml to determine the platform, host and project.',
                    )}
                </small>
            </label>

            {#if error}<div class="alert error">{error}</div>{/if}

            <div class="row end" style="margin-top: 14px">
                <button class="btn" type="button" onclick={onclose} disabled={saving}>{t('Отмена', 'Cancel')}</button>
                <button class="btn primary" type="submit" disabled={saving || !root.trim()}>
                    {saving ? t('Добавляю…', 'Adding…') : t('Добавить', 'Add')}
                </button>
            </div>
        </form>
    </div>
</div>
