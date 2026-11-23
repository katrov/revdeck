export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'revdeck.theme';

export const theme = $state({ mode: 'auto' as ThemeMode });

function apply(mode: ThemeMode): void {
    const root = document.documentElement;
    if (mode === 'auto') delete root.dataset.theme;
    else root.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode): void {
    theme.mode = mode;
    apply(mode);
    try {
        localStorage.setItem(KEY, mode);
    } catch {
        // localStorage may be unavailable.
    }
}

export function initTheme(): void {
    let mode: ThemeMode = 'auto';
    try {
        const stored = localStorage.getItem(KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'auto') mode = stored;
    } catch {
        // localStorage may be unavailable.
    }
    theme.mode = mode;
    apply(mode);
}
