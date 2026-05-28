#!/usr/bin/env node
// Builds public/wiki/index.json — used by client-side search (Fuse.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WIKI = path.join(ROOT, 'docs', 'wiki');
const OUT = path.join(ROOT, 'public', 'wiki', 'index.json');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

const entries = [];
for (const file of walk(WIKI)) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  entries.push({
    title: data.title,
    module: data.module,
    slug: data.slug,
    roles: data.roles ?? [],
    description: data.description ?? '',
    excerpt: content.replace(/[#*_`>\-]/g, '').slice(0, 400).trim(),
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));
console.log(`✓ Wrote ${entries.length} entries → ${path.relative(ROOT, OUT)}`);
