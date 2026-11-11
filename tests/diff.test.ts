import { describe, expect, it } from 'vitest';
import { findNewLine, linePosition, parseUnifiedDiff, snippetAround } from '../src/core/diff.js';

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,4 +10,5 @@ export function run() {
     const a = 1;
     const b = 2;
-    return a + b;
+    const c = a + b;
+    return c;
     // tail
 }
`;

describe('parseUnifiedDiff', () => {
    it('parses a modified file with correct line numbers', () => {
        const files = parseUnifiedDiff(PATCH);
        expect(files).toHaveLength(1);
        const file = files[0]!;
        expect(file.path).toBe('src/app.ts');
        expect(file.status).toBe('modified');
        expect(file.hunks).toHaveLength(1);
        const lines = file.hunks[0]!.lines;
        expect(lines.map((line) => line.kind).join('')).toBe('  -++ ');
        const removed = lines.find((line) => line.kind === '-')!;
        expect(removed.oldLine).toBe(12);
        expect(removed.newLine).toBeNull();
        const added = lines.filter((line) => line.kind === '+');
        expect(added[0]!.newLine).toBe(12);
        expect(added[1]!.newLine).toBe(13);
        const lastContext = lines[lines.length - 1]!;
        expect(lastContext.newLine).toBe(14);
        expect(lastContext.oldLine).toBe(13);
    });

    it('does not stop a hunk on diff-looking content lines', () => {
        const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
--- old comment
+++ new comment
+extra
`;
        const files = parseUnifiedDiff(patch);
        expect(files[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual(['-', '+', '+']);
        expect(files[0]!.hunks[0]!.lines[0]!.text).toBe('-- old comment');
        expect(files[0]!.hunks[0]!.lines[1]!.text).toBe('++ new comment');
    });

    it('handles added, deleted and renamed files', () => {
        const patch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+one
+two
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
diff --git a/old.ts b/renamed.ts
similarity index 90%
rename from old.ts
rename to renamed.ts
--- a/old.ts
+++ b/renamed.ts
@@ -1 +1 @@
-a
+b
`;
        const files = parseUnifiedDiff(patch);
        expect(files.map((file) => [file.path, file.status])).toEqual([
            ['new.ts', 'added'],
            ['gone.ts', 'deleted'],
            ['renamed.ts', 'renamed'],
        ]);
        expect(files[1]!.oldPath).toBe('gone.ts');
        expect(files[2]!.oldPath).toBe('old.ts');
    });

    it('parses gitlab-style diffs without ---/+++ headers', () => {
        const patch = `diff --git a/lib/x.ts b/lib/x.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;
        const files = parseUnifiedDiff(patch);
        expect(files[0]!.path).toBe('lib/x.ts');
        expect(files[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual([' ', '+', ' ']);
    });

    it('keeps paths with spaces and ignores no-newline markers', () => {
        const patch = `diff --git a/src/my file.ts b/src/my file.ts
--- a/src/my file.ts
+++ b/src/my file.ts
@@ -1 +1 @@
-old
+new
\\ No newline at end of file
`;
        const files = parseUnifiedDiff(patch);
        expect(files[0]!.path).toBe('src/my file.ts');
        expect(files[0]!.hunks[0]!.lines).toHaveLength(2);
    });

    it('marks binary files', () => {
        const files = parseUnifiedDiff('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n');
        expect(files[0]!.binary).toBe(true);
    });

    it('returns nothing for an empty patch', () => {
        expect(parseUnifiedDiff('')).toEqual([]);
    });

    it('finds snippets and positions', () => {
        const files = parseUnifiedDiff(PATCH);
        expect(findNewLine(files, 'src/app.ts', 12)?.kind).toBe('+');
        expect(snippetAround(files, 'src/app.ts', 13, 1)?.some((line) => line.target)).toBe(true);
        expect(linePosition(files, 'src/app.ts', 13)).toEqual({
            newPath: 'src/app.ts',
            newLine: 13,
            oldPath: 'src/app.ts',
            oldLine: null,
        });
        // Контекстная строка требует old_line для GitLab.
        expect(linePosition(files, 'src/app.ts', 14)?.oldLine).toBe(13);
        expect(findNewLine(files, 'src/app.ts', 999)).toBeUndefined();
    });
});
