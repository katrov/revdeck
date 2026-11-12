import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../ui/src/lib/markdown.js';

describe('UI markdown', () => {
    const gitlab = { baseUrl: 'https://gitlab.example.com', uploadsBaseUrl: 'https://gitlab.example.com/-/project/36' };

    it('renders GitLab upload images with the platform host and dimensions', () => {
        const html = renderMarkdown('![image.png](/uploads/abc/image.png){width=900 height=452}', gitlab);
        expect(html).toContain('<img');
        expect(html).toContain('src="https://gitlab.example.com/-/project/36/uploads/abc/image.png"');
        expect(html).toContain('alt="image.png"');
        expect(html).toContain('width="900"');
        expect(html).toContain('height="452"');
    });

    it('renders same-host absolute images and GitLab videos', () => {
        expect(renderMarkdown('![x](https://gitlab.example.com/uploads/a/x.png)', gitlab)).toContain('src="https://gitlab.example.com/-/project/36/uploads/a/x.png"');
        expect(renderMarkdown('![x](https://gitlab.example.com/-/project/36/uploads/a/x.png)', gitlab)).toContain('src="https://gitlab.example.com/-/project/36/uploads/a/x.png"');
        const video = renderMarkdown('![demo](/uploads/a/demo.mp4)', gitlab);
        expect(video).toContain('<video');
        expect(video).toContain('src="https://gitlab.example.com/-/project/36/uploads/a/demo.mp4"');
        expect(video).toContain('controls');
    });

    it('does not load external images', () => {
        const html = renderMarkdown('![tracker](https://evil.example/t.png)', gitlab);
        expect(html).not.toContain('<img');
        expect(html).toContain('<a href="https://evil.example/t.png"');
    });

    it('allows GitHub user attachments for GitHub reviews', () => {
        const html = renderMarkdown('![x](https://private-user-images.githubusercontent.com/1/x.png)', { baseUrl: 'https://github.com' });
        expect(html).toContain('<img');
    });
});
