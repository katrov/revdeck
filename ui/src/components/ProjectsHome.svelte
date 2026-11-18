<script lang="ts">
    import { app } from '../lib/state.svelte';
    import { projectColor, projectLabel } from '../lib/projects';
    import { t } from '../lib/i18n.svelte';
    import type { ProjectSummary } from '../lib/types';

    let {
        onselect,
        onopen,
        onadd,
        onedit,
        onremove,
    }: {
        onselect: (key: string) => void;
        onopen: () => void;
        onadd: () => void;
        onedit: (project: ProjectSummary) => void;
        onremove: (project: ProjectSummary) => void;
    } = $props();
    let query = $state('');

    const list = $derived(
        app.projects.filter((project) => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return `${project.key} ${project.title} ${project.host}/${project.project} ${project.roots.join(' ')}`.toLowerCase().includes(q);
        }),
    );
</script>

<section class="projects-home">
    <header class="projects-home-head">
        <div class="projects-home-intro">
            <h1>{t('Проекты', 'Projects')}</h1>
            <p class="muted">{t('Каждый проект — отдельный репозиторий со своими правилами и ревью. Агент видит только проект своей сессии.', 'Each project is a separate repository with its own rules and reviews. An agent sees only the project of its session.')}</p>
        </div>
        <div class="projects-home-actions">
            <input class="project-home-search" bind:value={query} placeholder={t('Найти проект…', 'Find a project…')} autocomplete="off" />
            <button class="btn" type="button" onclick={onadd}>{t('+ Добавить проект', '+ Add project')}</button>
            <button class="btn primary" type="button" onclick={onopen}>{t('Открыть ревью', 'Open review')}</button>
        </div>
    </header>

    {#if list.length}
        <div class="projects-grid">
            {#each list as project (project.key)}
                <div class="project-card">
                    <button class="project-card-open" type="button" onclick={() => onselect(project.key)}>
                        <span class="project-card-top">
                            <span class="project-dot" style={`--project-color:${projectColor(project.key)}`}></span>
                            <span class="project-card-name">{projectLabel(project, app.projects)}</span>
                            <span class="project-card-count">{project.reviews} {t('ревью', 'reviews')}</span>
                        </span>
                        <span class="project-card-path">{project.host}/{project.project}</span>
                        <span class="project-card-roots">{project.roots[0] ?? t('Нет рабочей копии', 'No working copy')}</span>
                    </button>
                    <div class="project-card-actions">
                        <button class="project-card-action" type="button" onclick={() => onedit(project)} title={t('Изменить проект', 'Edit project')}>
                            ✎ {t('Изменить', 'Edit')}
                        </button>
                        <button class="project-card-action danger" type="button" onclick={() => onremove(project)} title={t('Удалить проект из revdeck', 'Remove project from revdeck')}>
                            × {t('Удалить', 'Delete')}
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {:else if app.projects.length}
        <p class="muted">{t('Проекты не найдены.', 'No projects found.')}</p>
    {:else}
        <div class="card">
            <div class="card-title">{t('Пока нет проектов', 'No projects yet')}</div>
            <p class="muted">{t('Добавьте проект кнопкой выше или откройте ревью из репозитория.', 'Add a project with the button above or open a review from a repository.')}</p>
            <pre>revdeck projects add /path/to/repository
revdeck open 42</pre>
        </div>
    {/if}
</section>
