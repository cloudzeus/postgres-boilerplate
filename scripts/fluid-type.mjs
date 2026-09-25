#!/usr/bin/env node
// scripts/fluid-type.mjs — ο παραγωγός των tokens ρευστής τυπογραφίας.
//
// Σαρώνει τον κώδικα για μεγέθη που χρησιμοποιούνται και τυπώνει το μπλοκ `:root` που πρέπει να
// ζει στο `app/globals.css`. Ξανατρέξ' το όταν εμφανιστεί νέο μέγεθος.
//
//   node scripts/fluid-type.mjs           # τα μεγέθη που βρίσκει στον κώδικα
//   node scripts/fluid-type.mjs 10 12 18  # συγκεκριμένα μεγέθη
//
// Ο ΚΑΝΟΝΑΣ (ράμπα 360px → 1280px):
//   ≤ 15px  → +1px στο κινητό (το μικρό κείμενο ΜΕΓΑΛΩΝΕΙ, ποτέ δεν μικραίνει)
//   16–20px → αμετάβλητο
//   ≥ 22px  → ×0.78 στο κινητό (οι τίτλοι πρέπει να χωρέσουν σε 360px)
// Σε 1280px κάθε token δίνει ΑΚΡΙΒΩΣ το μέγεθος του ονόματός του — το desktop μένει ίδιο.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PHONE_W = 360;
const DESKTOP_W = 1280;
const ROOTS = ['app', 'components'];

/** Το μέγεθος στο κινητό για δεδομένο μέγεθος desktop. */
function phoneSize(d) {
  if (d <= 15) return d + 1;
  if (d <= 20) return d;
  return Math.round(d * 0.78 * 100) / 100;
}

const r = (x) => String(Math.round(x * 100000) / 100000);

function token(d) {
  const m = phoneSize(d);
  const name = `--fs-${String(d).replace('.', '-')}`;
  if (Math.abs(m - d) < 1e-9) return `  ${name}: ${r(d / 16)}rem;`;
  const slope = (d - m) / (DESKTOP_W - PHONE_W);
  const intercept = m - slope * PHONE_W;
  const min = Math.min(m, d) / 16;
  const max = Math.max(m, d) / 16;
  const sign = slope < 0 ? '-' : '+';
  return `  ${name}: clamp(${r(min)}rem, ${r(intercept / 16)}rem ${sign} ${r(Math.abs(slope * 100))}vw, ${r(max)}rem);`;
}

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts|css)$/.test(p)) yield p;
  }
}

function scan() {
  const found = new Set();
  for (const root of ROOTS) {
    let ok = true;
    try { statSync(root); } catch { ok = false; }
    if (!ok) continue;
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) found.add(Number(m[1]));
      for (const m of src.matchAll(/--fs-(\d+)/g)) found.add(Number(m[1]));
      for (const m of src.matchAll(/fontSize:\s*['"](\d+(?:\.\d+)?)px/g)) found.add(Number(m[1]));
    }
  }
  return [...found].sort((a, b) => a - b);
}

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const sizes = args.length ? args.sort((a, b) => a - b) : scan();

if (sizes.length === 0) {
  console.log('Δεν βρέθηκε κανένα μέγεθος.');
  process.exit(0);
}

console.log('@layer base {\n  :root {');
for (const d of sizes) console.log(`  ${token(d)}`);
console.log('  }\n}');

const stray = [];
for (const root of ROOTS) {
  try { statSync(root); } catch { continue; }
  for (const f of walk(root)) {
    const src = readFileSync(f, 'utf8');
    if (/text-\[\d+(?:\.\d+)?px\]/.test(src) || /fontSize:\s*['"]\d+(?:\.\d+)?px/.test(src)) stray.push(f);
  }
}
if (stray.length) {
  console.error(`\n⚠️  ${stray.length} αρχεία έχουν ΑΚΟΜΗ καρφωτά px — αντικατάστησέ τα με text-[length:var(--fs-N)]:`);
  for (const f of stray.slice(0, 20)) console.error(`   ${f}`);
}
