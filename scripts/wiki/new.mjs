#!/usr/bin/env node
// Usage: node scripts/wiki/new.mjs <module>/<slug> [--role ADMIN,EMPLOYEE] [--title "Title"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run wiki:new -- <module>/<slug> [--roles ADMIN,EMPLOYEE] [--title "Title"]');
  process.exit(1);
}

const target = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    flags[args[i].slice(2)] = args[i + 1];
    i++;
  }
}

const [moduleKey, slug] = target.split('/');
if (!moduleKey || !slug) {
  console.error('Format: <module>/<slug>, e.g. programs/import');
  process.exit(1);
}

const roles = (flags.roles ?? 'ADMIN,EMPLOYEE')
  .split(',')
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);
const title = flags.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const today = new Date().toISOString().slice(0, 10);

const mdxPath = path.join(ROOT, 'docs', 'wiki', moduleKey, `${slug}.mdx`);
const screenshotsDir = path.join(ROOT, 'public', 'wiki', 'screenshots', moduleKey, slug);

if (fs.existsSync(mdxPath)) {
  console.error(`Already exists: ${mdxPath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(mdxPath), { recursive: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const frontmatter = `---
title: "${title}"
module: ${moduleKey}
slug: ${slug}
roles: [${roles.join(', ')}]
order: 100
updatedAt: ${today}
description: ""
screenshots: []
related: []
helpAnchors: []
---

## Επισκόπηση

Σύντομη περιγραφή της λειτουργίας.

## Βήματα

<Steps>
  <li>Πρώτο βήμα.</li>
  <li>Δεύτερο βήμα.</li>
</Steps>

<Callout type="info">
  Χρήσιμη σημείωση για τον χρήστη.
</Callout>

## Στιγμιότυπα

Πρόσθεσε screenshots στο frontmatter \`screenshots:\` array ή χρησιμοποίησε inline:

{/* <Screenshot src="example.png" caption="..." /> */}
`;

fs.writeFileSync(mdxPath, frontmatter, 'utf8');
console.log(`✓ Created ${path.relative(ROOT, mdxPath)}`);
console.log(`✓ Screenshots dir ${path.relative(ROOT, screenshotsDir)}`);
console.log(`\nNext:\n  - Edit ${path.relative(ROOT, mdxPath)}\n  - Add helpAnchors so <PageHeader helpAnchor="..." /> can link to it.`);
