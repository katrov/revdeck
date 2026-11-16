import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checksForPaths, parseConfig } from '../src/core/config.js';
import { globToRegExp } from '../src/core/glob.js';

const examplesDir = path.join(process.cwd(), 'examples');
const files = readdirSync(examplesDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();

describe('example configurations', () => {
    it('has runnable examples', () => {
        expect(files.length).toBeGreaterThanOrEqual(2);
    });

    for (const file of files) {
        it(`${file} parses and stays review-ready`, () => {
            const text = readFileSync(path.join(examplesDir, file), 'utf8');
            const config = parseConfig(text, file);

            expect(config.version).toBe(1);
            expect(config.provider.type === 'auto' || config.provider.project).toBeTruthy();
            expect(config.rules.map.length).toBeGreaterThan(0);
            expect(config.checks.length).toBeGreaterThan(0);

            for (const entry of config.rules.map) {
                expect(entry.match.length).toBeGreaterThan(0);
                expect(entry.docs.length).toBeGreaterThan(0);
                for (const pattern of entry.match) {
                    expect(() => globToRegExp(pattern)).not.toThrow();
                }
            }
            for (const check of config.checks) {
                expect(check.argv.length).toBeGreaterThan(0);
            }

            const matched = checksForPaths(config, ['src/index.ts', 'apps/dashboards/src/App.tsx']);
            expect(matched.some((check) => check.matched)).toBe(true);
        });
    }
});
