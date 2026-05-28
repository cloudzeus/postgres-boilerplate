#!/usr/bin/env node
/**
 * Wiki screenshot generator.
 *
 * Reads every docs/wiki/<module>/<slug>.mdx, finds frontmatter screenshots[]
 * with a `route`, logs in as the requested role using credentials from .env.test
 * (or .env.local fallback), navigates, runs optional actions[], and writes
 * public/wiki/screenshots/<module>/<slug>/<file>.
 *
 * Filter by module: `npm run wiki:screenshots -- --module programs`
 *
 * Requires: @playwright/test (install with `npm i -D @playwright/test && npx playwright install chromium`)
 *
 * Action DSL (strings in `actions`):
 *   click:<selector>
 *   fill:<selector>=<value>
 *   wait:<ms>
 *   waitFor:<selector>
 *   goto:<path>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WIKI = path.join(ROOT, 'docs', 'wiki');
const OUT_ROOT = path.join(ROOT, 'public', 'wiki', 'screenshots');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { flags[args[i].slice(2)] = args[i + 1]; i++; }
}

const BASE_URL = process.env.WIKI_BASE_URL ?? 'http://localhost:3000';

// Per-role credentials. Override via env: WIKI_USER_<ROLE>=email:password
function credsFor(role) {
  const envKey = `WIKI_USER_${role}`;
  if (process.env[envKey]) {
    const [email, password] = process.env[envKey].split(':');
    return { email, password };
  }
  return null;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

async function login(page, role) {
  const creds = credsFor(role);
  if (!creds) throw new Error(`No credentials for role ${role}. Set env WIKI_USER_${role}=email:password`);
  await page.goto(`${BASE_URL}/auth/signin`);
  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.toString().includes('/auth/signin'), { timeout: 15000 });
}

async function runActions(page, actions = []) {
  for (const a of actions) {
    const [op, rest] = a.split(':', 2);
    const arg = a.slice(op.length + 1);
    if (op === 'click') await page.click(arg);
    else if (op === 'fill') {
      const eq = arg.indexOf('=');
      await page.fill(arg.slice(0, eq), arg.slice(eq + 1));
    } else if (op === 'wait') await page.waitForTimeout(parseInt(arg, 10));
    else if (op === 'waitFor') await page.waitForSelector(arg);
    else if (op === 'goto') await page.goto(`${BASE_URL}${arg}`);
    else console.warn(`Unknown action: ${a}`);
  }
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    console.error('Missing @playwright/test. Install with:');
    console.error('  npm i -D @playwright/test && npx playwright install chromium');
    process.exit(1);
  }

  const files = walk(WIKI).filter((f) => !flags.module || f.includes(`/${flags.module}/`));
  const browser = await chromium.launch();
  const contexts = new Map(); // role -> context

  for (const file of files) {
    const { data } = matter(fs.readFileSync(file, 'utf8'));
    const screenshots = (data.screenshots ?? []).filter((s) => s.route);
    if (screenshots.length === 0) continue;

    for (const shot of screenshots) {
      const role = shot.asRole ?? (data.roles?.[0] ?? 'ADMIN');
      if (!contexts.has(role)) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        try { await login(page, role); }
        catch (e) { console.error(`✗ Login failed for ${role}: ${e.message}`); await ctx.close(); continue; }
        await page.close();
        contexts.set(role, ctx);
      }
      const ctx = contexts.get(role);
      if (!ctx) continue;
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: 'networkidle' });
      if (shot.actions) await runActions(page, shot.actions);

      const outDir = path.join(OUT_ROOT, data.module, data.slug);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, shot.file);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`✓ ${path.relative(ROOT, outPath)} (role=${role})`);
      await page.close();
    }
  }

  for (const ctx of contexts.values()) await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
