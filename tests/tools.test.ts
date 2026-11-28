import { describe, expect, it } from 'vitest';
import { installPlan } from '../src/cli/tools.js';
import { setLocale } from '../src/core/locale.js';

describe('platform tool install plans', () => {
    it('prefers the user-level Homebrew install', () => {
        setLocale('ru');
        const plan = installPlan('glab', { brew: '/opt/homebrew/bin/brew', pacman: '/usr/bin/pacman' });
        expect(plan).toMatchObject({
            tool: 'glab',
            manager: 'brew',
            command: 'brew install glab',
            automatic: true,
            url: 'https://docs.gitlab.com/cli/installation/',
        });
    });

    it('keeps pacman manual because it needs sudo', () => {
        const gh = installPlan('gh', { pacman: '/usr/bin/pacman' });
        expect(gh).toMatchObject({ manager: 'pacman', command: 'sudo pacman -S github-cli', automatic: false });
        expect(gh.manualReason).toContain('sudo');
    });

    it('only offers winget for the GitHub CLI', () => {
        expect(installPlan('gh', { winget: '/usr/bin/winget' })).toMatchObject({ manager: 'winget', automatic: true });
        expect(installPlan('glab', { winget: '/usr/bin/winget' })).toMatchObject({ manager: null, command: null });
    });

    it('falls back to the official guide without a package manager', () => {
        const plan = installPlan('glab', {});
        expect(plan.manager).toBeNull();
        expect(plan.command).toBeNull();
        expect(plan.url).toContain('gitlab.com');
    });
});
