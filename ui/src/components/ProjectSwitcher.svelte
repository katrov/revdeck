<script lang="ts">
    import { app, pinnedProjects, showProjectsHome, togglePinnedProject } from '../lib/state.svelte';
    import { projectColor, projectLabel, sortProjects } from '../lib/projects';
    import { t } from '../lib/i18n.svelte';

    let { onclose, onselect, onadd }: { onclose: () => void; onselect: (key: string) => void; onadd: () => void } = $props();

    let query = $state('');
    let input: HTMLInputElement | undefined = $state();
    let pinned = $state<string[]>(pinnedProjects());

    $effect(() => {
        input?.focus();
    });

    const list = $derived(
        sortProjects(app.projects, pinned).filter((project) => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return `${project.key} ${project.title} ${project.host}/${project.project} ${project.roots.join(' ')}`.toLowerCase().includes(q);
        }),
    );

    function pin(event: MouseEvent, key: string): void {
        event.stopPropagation();
        togglePinnedProject(key);
        pinned = pinnedProjects();
    }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<button class="project-popover-backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
<div class="project-popover" role="dialog" aria-modal="true" aria-label={t('Проекты', 'Projects')}>
    <div class="project-popover-head">
        {t('Проекты', 'Projects')}
        <span class="project-popover-kbd">P</span>
    </div>
    <label class="project-search">
        <span aria-hidden="true">⌕</span>
        <input bind:this={input} bind:value={query} placeholder={t('Найти проект…', 'Find a project…')} autocomplete="off" />
    </label>

    <div class="project-popover-label">{t('ПРОЕКТЫ', 'PROJECTS')}</div>
    <div class="project-popover-list">
        {#each list as project (project.key)}
            <div class="project-popover-row" class:active={app.activeProject === project.key}>
                <button class="project-popover-item" type="button" onclick={() => onselect(project.key)}>
                    <span class="project-dot" style={`--project-color:${projectColor(project.key)}`}></span>
                    <span class="project-popover-text">
                        <span class="project-popover-name">{projectLabel(project, app.projects)}</span>
                        <span class="project-popover-path">{project.host}/{project.project}</span>
                    </span>
                    <span class="project-popover-count">{project.reviews}</span>
                    {#if app.activeProject === project.key}<span class="project-popover-check">✓</span>{/if}
                </button>
                <button
                    class="project-pin"
                    class:on={pinned.includes(project.key)}
                    type="button"
                    title={pinned.includes(project.key) ? t('Открепить', 'Unpin') : t('Закрепить', 'Pin')}
                    aria-label={pinned.includes(project.key) ? t('Открепить', 'Unpin') : t('Закрепить', 'Pin')}
                    onclick={(event) => pin(event, project.key)}
                >★</button>
            </div>
        {:else}
            <p class="muted small project-popover-empty">{t('Проекты не найдены.', 'No projects found.')}</p>
        {/each}
    </div>

    <div class="project-popover-sep"></div>
    <button class="project-popover-action" type="button" onclick={() => { onadd(); }}>
        {t('+ Добавить проект', '+ Add project')}
    </button>
    <button class="project-popover-action" type="button" onclick={() => { showProjectsHome(); onclose(); }}>
        {t('Все проекты', 'All projects')}
    </button>
    <p class="project-popover-hint">{t('Изменить или удалить проект — на экране «Все проекты».', 'Edit or delete a project on the “All projects” screen.')}</p>
</div>
