<script lang="ts">
    import { addFeatureNote, deleteFeatureNote } from '../lib/api';
    import { errorText, loadFeature, loadFeatures, notify } from '../lib/state.svelte';
    import type { FeatureDetail } from '../lib/types';
    import { t } from '../lib/i18n.svelte';

    let { feature }: { feature: FeatureDetail } = $props();
    let title = $state('');
    let body = $state('');
    let kind = $state<'note' | 'finding'>('note');
    let level = $state('major');
    let saving = $state(false);

    async function add(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!title.trim() || saving) return;
        saving = true;
        try {
            await addFeatureNote(feature.id, {
                kind,
                ...(kind === 'finding' ? { level } : {}),
                title: title.trim(),
                body,
            });
            title = '';
            body = '';
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
        } catch (cause) {
            notify(errorText(cause), 'error');
        } finally {
            saving = false;
        }
    }

    async function remove(note: string): Promise<void> {
        if (!confirm(t('Удалить заметку?', 'Delete the note?'))) return;
        try {
            await deleteFeatureNote(feature.id, note);
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
        } catch (cause) {
            notify(errorText(cause), 'error');
        }
    }
</script>

<section class="card feature-notes">
    <div class="card-title">{t('Заметки фичи', 'Feature notes')}</div>
    <p class="muted small">
        {t('Кросс-проектные заметки. Не публикуются; конкретные правки остаются в ревью.', 'Cross-project notes. Never published; actionable changes stay on reviews.')}
    </p>

    {#if feature.notes.length}
        <div class="feature-note-list">
            {#each feature.notes as note (note.id)}
                <article class="feature-note">
                    <div class="row" style="justify-content: space-between; align-items: flex-start">
                        <div class="row" style="gap: 7px; align-items: center">
                            <span class="badge {note.kind === 'finding' ? note.level || 'major' : ''}">
                                {note.kind}{note.level && note.kind === 'finding' ? ` · ${note.level}` : ''}
                            </span>
                            <strong>{note.title}</strong>
                        </div>
                        <button class="btn danger" type="button" title={t('Удалить', 'Delete')} aria-label={t('Удалить', 'Delete')} onclick={() => void remove(note.id)}>×</button>
                    </div>
                    {#if note.body.trim()}<p class="feature-note-body">{note.body}</p>{/if}
                    <div class="muted small">{note.author} · {new Date(note.createdAt).toLocaleString()}</div>
                </article>
            {/each}
        </div>
    {:else}
        <p class="muted">{t('Заметок пока нет.', 'No notes yet.')}</p>
    {/if}

    <form class="feature-note-form" onsubmit={add}>
        <div class="row">
            <select bind:value={kind} aria-label={t('Тип заметки', 'Note kind')}>
                <option value="note">{t('заметка', 'note')}</option>
                <option value="finding">{t('находка', 'finding')}</option>
            </select>
            {#if kind === 'finding'}
                <select bind:value={level} aria-label={t('Уровень', 'Level')}>
                    <option value="blocker">blocker</option>
                    <option value="major">major</option>
                    <option value="minor">minor</option>
                    <option value="question">question</option>
                </select>
            {/if}
            <input class="feature-note-title" bind:value={title} placeholder={t('Заголовок', 'Title')} autocomplete="off" />
        </div>
        <textarea bind:value={body} rows="3" placeholder={t('Кросс-проектный вывод, вопрос по контракту…', 'Cross-project observation, contract question…')}></textarea>
        <div class="row end">
            <button class="btn" type="submit" disabled={saving || !title.trim()}>{saving ? t('Сохранение…', 'Saving…') : t('Добавить заметку', 'Add note')}</button>
        </div>
    </form>
</section>
