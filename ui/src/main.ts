import { mount } from 'svelte';
import './app.css';
import { i18n, setLocale } from './lib/i18n.svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app');
setLocale(i18n.locale);
mount(App, { target });
