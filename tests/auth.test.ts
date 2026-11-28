import { describe, expect, it } from 'vitest';
import type { RunOptions, Runner } from '../src/core/exec.js';
import { authLogin, authStatus, authTargets, parseAuthTarget, parseToken } from '../src/providers/auth.js';

interface Call {
    command: string;
    args: string[];
    env: Record<string, string>;
    input?: string;
}

function fakeRun(handler: (call: Call) => unknown): { run: Runner; calls: Call[] } {
    const calls: Call[] = [];
    const run: Runner = async (command: string, args: string[], options: RunOptions = {}) => {
        const call: Call = { command, args, env: options.env ?? {}, ...(options.input === undefined ? {} : { input: options.input }) };
        calls.push(call);
        return { stdout: JSON.stringify(handler(call)), stderr: '', code: 0 };
    };
    return { run, calls };
}

const resolve = async (): Promise<string> => '/home/user/.local/bin/glab-or-gh';
const target = { platform: 'gitlab' as const, host: 'gitlab.example.com' };

describe('platform auth', () => {
    it('reports a GitLab login without leaking anything but the account', async () => {
        const { run, calls } = fakeRun(() => ({ username: 'alice', name: 'Alice' }));
        const state = await authStatus(target, { run, resolve });
        expect(calls[0]?.command).toBe('glab');
        expect(calls[0]?.args).toEqual(['api', '--hostname', 'gitlab.example.com', 'user']);
        expect(state).toMatchObject({ platform: 'gitlab', host: 'gitlab.example.com', binary: true, authenticated: true, account: 'alice' });
    });

    it('uses GH_HOST for GitHub and reads the login', async () => {
        const { run, calls } = fakeRun(() => ({ login: 'octocat' }));
        const state = await authStatus({ platform: 'github', host: 'github.com' }, { run, resolve });
        expect(calls[0]?.command).toBe('gh');
        expect(calls[0]?.args).toEqual(['api', 'user']);
        expect(calls[0]?.env).toMatchObject({ GH_HOST: 'github.com' });
        expect(state).toMatchObject({ authenticated: true, account: 'octocat' });
    });

    it('reports a missing CLI instead of spawning it', async () => {
        const { run, calls } = fakeRun(() => ({}));
        const state = await authStatus(target, { run, resolve: async () => null });
        expect(calls).toHaveLength(0);
        expect(state).toMatchObject({ binary: false, authenticated: false });
        expect(state.hint).toContain('glab');
    });

    it('suggests a package-manager command only when that manager exists', async () => {
        const withBrew = await authStatus(target, {
            resolve: async (command) => (command === 'brew' ? '/opt/homebrew/bin/brew' : null),
        });
        expect(withBrew.install).toEqual({ url: 'https://docs.gitlab.com/cli/installation/', command: 'brew install glab' });
        expect(withBrew.hint).toContain('перезапустите демон');

        const without = await authStatus(target, { resolve: async () => null });
        expect(without.install).toEqual({ url: 'https://docs.gitlab.com/cli/installation/' });
    });

    it('explains why the check failed and suggests a way in', async () => {
        const run: Runner = async () => {
            throw new Error('HTTP 401: Unauthorized');
        };
        const state = await authStatus(target, { run, resolve });
        expect(state).toMatchObject({ binary: true, authenticated: false });
        expect(state.error).toContain('401');
        expect(state.hint).toContain('auth login');
    });

    it('verifies a GitLab token, stores it via stdin and keeps it out of argv and env', async () => {
        const token = 'glpat-abcdefghijklmnopqrst';
        const { run, calls } = fakeRun((call) => (call.args[0] === 'api' ? { username: 'alice' } : 'Logged in'));
        const state = await authLogin(target, token, { run, resolve });

        expect(calls[0]?.env).toMatchObject({ GITLAB_TOKEN: token });
        expect(calls[1]?.args).toEqual(['auth', 'login', '--hostname', 'gitlab.example.com', '--stdin']);
        expect(calls[1]?.input).toBe(token);
        expect(calls[1]?.env).not.toHaveProperty('GITLAB_TOKEN');
        for (const call of calls) expect(call.args.join(' ')).not.toContain(token);
        expect(calls[2]?.env).not.toHaveProperty('GITLAB_TOKEN');
        expect(state).toMatchObject({ authenticated: true, account: 'alice' });
    });

    it('passes a GitHub token to gh on stdin under --with-token', async () => {
        const token = 'ghp_abcdefghijklmnopqrstuvwxyz012345';
        const { run, calls } = fakeRun((call) => (call.args[0] === 'api' ? { login: 'octocat' } : ''));
        const state = await authLogin({ platform: 'github', host: 'github.com' }, token, { run, resolve });

        expect(calls[0]?.env).toMatchObject({ GH_HOST: 'github.com', GH_TOKEN: token });
        expect(calls[1]?.args).toEqual(['auth', 'login', '--hostname', 'github.com', '--with-token']);
        expect(calls[1]?.input).toBe(token);
        expect(calls[1]?.env).not.toHaveProperty('GH_TOKEN');
        expect(state).toMatchObject({ authenticated: true, account: 'octocat' });
    });

    it('does not store a token the platform rejected', async () => {
        let calls = 0;
        const run: Runner = async () => {
            calls += 1;
            throw new Error('HTTP 401: Bad credentials');
        };
        await expect(authLogin(target, 'glpat-abcdefghijklmnopqrst', { run, resolve })).rejects.toMatchObject({ code: 'AUTH' });
        expect(calls).toBe(1);
    });

    it('redacts the token from platform errors', async () => {
        const token = 'glpat-secretsecretsecret';
        const run: Runner = async () => {
            throw new Error(`invalid token ${token}`);
        };
        const error = await authLogin(target, token, { run, resolve }).catch((cause: unknown) => cause as Error);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw error;
        expect(error.message).not.toContain(token);
        expect(error.message).toContain('gl-***');
    });

    it('refuses to log in when the CLI is missing', async () => {
        const { run, calls } = fakeRun(() => ({}));
        await expect(authLogin(target, 'glpat-abcdefghijklmnopqrst', { run, resolve: async () => null })).rejects.toMatchObject({
            code: 'ENVIRONMENT',
        });
        expect(calls).toHaveLength(0);
    });

    it('rejects a malformed host or platform', () => {
        expect(parseAuthTarget('gitlab', 'GitLab.Example.com:8443')).toEqual({ platform: 'gitlab', host: 'gitlab.example.com:8443' });
        expect(() => parseAuthTarget('bitbucket', 'gitlab.com')).toThrow();
        for (const host of ['https://gitlab.com', 'gitlab.com/group', 'git..lab.com', 'git lab.com', '', '-gitlab.com']) {
            expect(() => parseAuthTarget('gitlab', host)).toThrow();
        }
    });

    it('accepts a pasted token with a trailing newline but not inner whitespace', () => {
        expect(parseToken('glpat-abcdefghijklmnopqrst\n')).toBe('glpat-abcdefghijklmnopqrst');
        expect(() => parseToken('short')).toThrow();
        expect(() => parseToken('two words here')).toThrow();
        expect(() => parseToken('x'.repeat(5000))).toThrow();
    });

    it('lists each platform host from the registry once', () => {
        expect(
            authTargets([
                { platform: 'gitlab', host: 'gitlab.example.com' },
                { platform: 'gitlab', host: 'GitLab.example.com' },
                { platform: 'github', host: 'github.com' },
                { platform: 'gitlab', host: '' },
                { platform: 'local', host: 'devbox' },
            ]),
        ).toEqual([
            { platform: 'gitlab', host: 'gitlab.example.com' },
            { platform: 'github', host: 'github.com' },
        ]);
    });
});
