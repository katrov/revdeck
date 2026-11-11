import { describe, expect, it } from 'vitest';
import { detectLocale, plural, resolveOutputLanguage, setLocale } from '../src/core/locale.js';

describe('locale', () => {
    it('detects an explicit or system locale', () => {
        expect(detectLocale('ru')).toBe('ru');
        expect(detectLocale('en')).toBe('en');
        expect(detectLocale('ru_RU.UTF-8')).toBe('ru');
        expect(detectLocale('C.UTF-8')).toBe('en');
    });

    it('resolves auto output language from the review text', () => {
        expect(resolveOutputLanguage('auto', ['Привет, мир'])).toBe('ru');
        expect(resolveOutputLanguage('auto', ['Hello world'])).toBe('en');
        expect(resolveOutputLanguage('auto', [''])).toBe('en');
        expect(resolveOutputLanguage('ru', ['Hello world'])).toBe('ru');
        expect(resolveOutputLanguage('en', ['Привет'])).toBe('en');
    });

    it('pluralizes for the active locale', () => {
        setLocale('en');
        expect(plural(1, 'файл', 'файла', 'файлов', 'file', 'files')).toBe('file');
        expect(plural(3, 'файл', 'файла', 'файлов', 'file', 'files')).toBe('files');
        setLocale('ru');
        expect(plural(1, 'файл', 'файла', 'файлов', 'file', 'files')).toBe('файл');
        expect(plural(3, 'файл', 'файла', 'файлов', 'file', 'files')).toBe('файла');
        expect(plural(11, 'файл', 'файла', 'файлов', 'file', 'files')).toBe('файлов');
    });
});
