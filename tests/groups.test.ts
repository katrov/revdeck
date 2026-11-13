import { describe, expect, it } from 'vitest';
import { computeGroups } from '../src/core/groups.js';
import { parseUnifiedDiff } from '../src/core/diff.js';

const diff = parseUnifiedDiff(`diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,2 @@
 old
+new
diff --git a/docs/Guide.md b/docs/Guide.md
--- a/docs/Guide.md
+++ b/docs/Guide.md
@@ -1,1 +1,2 @@
 old
+new
`);

describe('change groups', () => {
    it('groups by file kind and module', () => {
        const groups = computeGroups(diff);
        expect(groups.map((group) => group.id)).toEqual(expect.arrayContaining(['module:src', 'docs']));
    });

    it('applies explicit custom groups first', () => {
        const groups = computeGroups(diff, [{ id: 'app', title: 'Application', match: ['src/**'] }]);
        expect(groups.find((group) => group.id === 'app')?.files).toEqual(['src/app.ts']);
    });
});
