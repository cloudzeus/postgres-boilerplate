import { describe, it, expect } from 'vitest';
import { compileMdxToHtml } from '../wiki/compile';
import { WIKI_VIDEOS } from '../wiki/videos';

describe('<Video> στο wiki', () => {
  it('γνωστό βίντεο ⇒ <video> χωρίς autoplay, με poster και δύο πηγές', async () => {
    WIKI_VIDEOS.__test = { title: 'Δοκιμή', summary: '', mp4: 'https://cdn.example/x.mp4', webm: 'https://cdn.example/x.webm', poster: 'https://cdn.example/x.jpg', seconds: 65 };
    const html = await compileMdxToHtml('Κείμενο\n\n<Video id="__test" />\n', 'ocr', 'x');
    expect(html).toContain('<video controls preload="none"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('x.webm');
    expect(html).toContain('1:05');
    delete WIKI_VIDEOS.__test;
  });
  it('άγνωστο βίντεο ⇒ ήπιο μήνυμα, όχι σπασμένο player', async () => {
    const html = await compileMdxToHtml('<Video id="nope" />\n', 'ocr', 'x');
    expect(html).toContain('δεν είναι ακόμη διαθέσιμο');
  });
});
