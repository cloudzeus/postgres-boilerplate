import fs from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import matter from 'gray-matter';
import { WikiFrontmatterSchema, MODULE_LABELS, type WikiPage, type WikiModule } from './types';

const WIKI_ROOT = path.join(process.cwd(), 'docs', 'wiki');

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

export const loadAllPages = cache((): WikiPage[] => {
  const files = walk(WIKI_ROOT);
  const pages: WikiPage[] = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const fm = WikiFrontmatterSchema.safeParse(parsed.data);
    if (!fm.success) {
      console.warn(`[wiki] invalid frontmatter in ${filePath}:`, fm.error.flatten());
      continue;
    }
    pages.push({
      frontmatter: fm.data,
      content: parsed.content,
      filePath,
    });
  }
  pages.sort((a, b) => a.frontmatter.order - b.frontmatter.order || a.frontmatter.title.localeCompare(b.frontmatter.title, 'el'));
  return pages;
});

export const loadPage = cache((moduleKey: string, slug: string): WikiPage | null => {
  return loadAllPages().find((p) => p.frontmatter.module === moduleKey && p.frontmatter.slug === slug) ?? null;
});

export const getModulesTree = cache((): WikiModule[] => {
  const pages = loadAllPages();
  const byModule = new Map<string, WikiPage[]>();
  for (const page of pages) {
    const list = byModule.get(page.frontmatter.module) ?? [];
    list.push(page);
    byModule.set(page.frontmatter.module, list);
  }
  return Array.from(byModule.entries())
    .map(([module, pgs]) => ({
      module,
      title: MODULE_LABELS[module] ?? module,
      pages: pgs,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'el'));
});

export function findHelpAnchor(anchor: string): WikiPage | null {
  return loadAllPages().find((p) => p.frontmatter.helpAnchors.includes(anchor)) ?? null;
}
