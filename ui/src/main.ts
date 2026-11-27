import { mount } from 'svelte';
import './app.css';
import { applyLocale, i18n } from './lib/i18n.svelte';
import { restorePreferences } from './lib/preferences';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app');

// Локальный кеш — сразу; сохранённые на демоне настройки — до первого кадра,
// чтобы тема и язык не мигали сбросом на значении по умолчанию.
applyLocale(i18n.locale);
await restorePreferences();
mount(App, { target });
