import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function preprocess(src: string, moduleKey: string, slug: string): string {
  let out = src;
  out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  out = out.replace(/<Screenshot\s+([^/>]*)\/>/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    const src = a.src?.startsWith('/') ? a.src : `/wiki/screenshots/${moduleKey}/${slug}/${a.src ?? ''}`;
    const caption = (a.caption ?? '').replace(/"/g, '&quot;');
    return `<figure class="wiki-screenshot"><img src="${src}" alt="${caption}" loading="lazy" />${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  });

  out = out.replace(/<RoleBadge\s+role="([^"]+)"\s*\/>/g, '<span class="wiki-role-badge">$1</span>');

  out = out.replace(/<Callout(?:\s+type="(info|warning|success|danger)")?>([\s\S]*?)<\/Callout>/g, (_, type, inner) => {
    const t = type ?? 'info';
    return `<div class="wiki-callout wiki-callout-${t}">\n\n${inner.trim()}\n\n</div>`;
  });

  out = out.replace(/<Steps>([\s\S]*?)<\/Steps>/g, (_, inner) => {
    return `<ol class="wiki-steps">\n${inner.trim()}\n</ol>`;
  });

  return out;
}

export async function compileMdxToHtml(content: string, moduleKey: string, slug: string): Promise<string> {
  const pre = preprocess(content, moduleKey, slug);
  const file = await remark().use(remarkGfm).use(remarkHtml, { sanitize: false }).process(pre);
  return String(file);
}
