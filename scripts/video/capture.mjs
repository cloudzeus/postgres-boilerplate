#!/usr/bin/env node
/**
 * Λήψη υλικού για το video παρουσίασης (docs/marketing/video-parousiasi-efarmogis.md).
 *
 * Για κάθε σκηνή: ένα video (1920×1080, με ορατό δρομέα και αργές κινήσεις) + screenshots στα
 * σημεία-κλειδιά. Τα κείμενα οθόνης ΔΕΝ μπαίνουν εδώ — μπαίνουν στο μοντάζ.
 *
 * ΜΟΝΟ ΑΝΑΓΝΩΣΗ: καμία καταχώριση, αποθήκευση, ανέβασμα, μετασχηματισμός, AI ή VIES — η τοπική
 * βάση είναι παραγωγή. Οι σκηνές που χρειάζονται εγγραφή γυρίζονται χειροκίνητα σε Demo (βλ. README
 * που γράφεται δίπλα στις λήψεις).
 *
 * Χρήση (dev server ανοιχτός):
 *   node --env-file=.env scripts/video/capture.mjs                 # όλες οι σκηνές
 *   node --env-file=.env scripts/video/capture.mjs --only s01,s12  # επιλεγμένες
 * Σύνδεση: WIKI_USER_SUPER_ADMIN=email:password (ίδιος χρήστης με τα screenshots του wiki).
 * Έξοδος: marketing-captures/<ημερομηνία>/ (εκτός git — περιέχει πραγματικά δεδομένα).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.WIKI_BASE_URL ?? 'http://localhost:3000';
const W = 1920, H = 1080;
const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const OUT = path.join(ROOT, 'marketing-captures', new Date().toISOString().slice(0, 10));
fs.mkdirSync(OUT, { recursive: true });

// Έγγραφα του σεναρίου (αλλάξτε τα αν χρειάζεται).
const DOC_OPEN = process.env.CAPTURE_DOC ?? 'cmv9aj595000301qwmcs06wi5';      // τιμολόγιο αγοράς, μη αναρτημένο
const DOC_POSTED = process.env.CAPTURE_DOC_POSTED ?? 'cmv9aj6o9000401qw9rdk6a3g'; // ήδη αναρτημένο
const DOC_LINES = process.env.CAPTURE_DOC_LINES ?? 'cmv6kuv0v000901lmls3lk5qt';  // με πολλές γραμμές
const TEMPLATE = process.env.CAPTURE_TEMPLATE ?? 'cmtuba4j9001006d444lod9m9';
const TRADER_ROW = process.env.CAPTURE_TRADER ?? 'SOL HELLAS';
const DOC_FOREIGN = process.env.CAPTURE_DOC_FOREIGN ?? 'cmuh6oh5c0019s5d47mgqa58j'; // ξένος εκδότης (IT)
const DOC_ASSET = process.env.CAPTURE_DOC_ASSET ?? 'cmppatl8n0001gkd4c6am4rdt';     // με γραμμή παγίου

// ── Ορατός δρομέας + «κύμα» κλικ (το headless video δεν δείχνει δρομέα) ──────────────────
const CURSOR_JS = `
(() => {
  if (window.__fakeCursor) return; window.__fakeCursor = true;
  const add = () => {
    // Το εικονίδιο του Next.js dev (κάτω αριστερά) δεν ανήκει στο βίντεο.
    const st = document.createElement('style');
    st.textContent = 'nextjs-portal{display:none!important}';
    document.documentElement.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cursor';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px',
      borderRadius: '50%', background: 'rgba(14,22,38,.82)', border: '3px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,.35)',
      zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .12s ease' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      c.style.transform = 'scale(.8)';
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '16px', height: '16px', marginLeft: '-8px', marginTop: '-8px',
        borderRadius: '50%', border: '3px solid #2563eb', zIndex: 2147483646, pointerEvents: 'none', transition: 'all .45s ease-out', opacity: '1' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { Object.assign(r.style, { width: '64px', height: '64px', marginLeft: '-32px', marginTop: '-32px', opacity: '0' }); });
      setTimeout(() => r.remove(), 500);
    }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

const pause = (page, ms) => page.waitForTimeout(ms);
let mouse = { x: W / 2, y: H / 2 };

async function cursorTo(page, target, { steps = 28 } = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error(`δεν βρέθηκε: ${target}`);
  const x = box.x + Math.min(box.width / 2, 60), y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  return loc;
}
async function hover(page, target, ms = 900) { await cursorTo(page, target); await pause(page, ms); }
async function click(page, target, after = 1400) {
  await cursorTo(page, target);
  await pause(page, 450);
  await page.mouse.down(); await page.mouse.up();
  await pause(page, after);
}
async function scrollBy(page, dy, { steps = 14 } = {}) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(page, 45); }
  await pause(page, 700);
}
async function shot(page, scene, name) {
  const file = path.join(OUT, `${scene}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}
async function go(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.mouse.move(mouse.x, mouse.y);
  await pause(page, 1200);
}
const byRole = (page, role, name) => page.getByRole(role, { name }).first();
const byText = (page, text) => page.getByText(text, { exact: false }).first();

// ── Σκηνές (αντιστοιχούν στο §6 του σεναρίου) ──────────────────────────────────────────
const SCENES = [
  { id: 's01', name: 'dashboard', run: async (p) => {
    await go(p, '/admin');
    await shot(p, 's01', '1-kpis');
    await click(p, byRole(p, 'link', /30 ημ/));
    await shot(p, 's01', '2-30-days');
    await scrollBy(p, 650); await shot(p, 's01', '3-charts');
    await scrollBy(p, 650); await shot(p, 's01', '4-attention');
    await scrollBy(p, -1300);
  } },
  { id: 's02', name: 'navigation', run: async (p) => {
    await go(p, '/admin');
    // Οι ομάδες του μενού ανοίγουν μία-μία (κατάσταση UI μόνο).
    for (const group of ['Δεδομένα', 'Λογιστική αρχικοποίηση', 'Σύστημα', 'Access control', 'Βοήθεια']) {
      await click(p, p.getByRole('button', { name: new RegExp(`^${group}$`, 'i') }).first(), 700).catch(() => {});
    }
    for (const label of ['Dashboard', 'Συναλλασσόμενοι', 'OCR / Έγγραφα', 'Νέοι συναλλασσόμενοι', 'Είδη & έξοδα', 'Εκκρεμότητες OCR', 'Πρότυπα εξαγωγής', 'Λογιστικό σχέδιο', 'Ρυθμίσεις', 'Χρήστες', 'Οδηγός Χρήστη']) {
      await hover(p, byRole(p, 'link', label), 650).catch(() => {});
    }
    await shot(p, 's02', '1-sidebar');
    await go(p, '/admin/ocr');
    await hover(p, p.locator('a[href^="/wiki"]').last(), 1200).catch(() => {});
    await shot(p, 's02', '2-help-icon');
  } },
  { id: 's03', name: 'upload', run: async (p) => {
    await go(p, '/admin/ocr');
    await shot(p, 's03', '1-stats-upload');
    await hover(p, byText(p, 'Σύρε αρχείο'), 1500).catch(() => {});
    await shot(p, 's03', '2-dropzone');
    await scrollBy(p, 500);
    await hover(p, p.locator('table tbody tr').nth(1), 900).catch(() => {});
    await hover(p, p.locator('table tbody tr').nth(3), 900).catch(() => {});
    await shot(p, 's03', '3-list');
  } },
  { id: 's04', name: 'document', run: async (p) => {
    await go(p, `/admin/ocr/${DOC_LINES}`);
    // Η προβολή του PDF (iframe) φορτώνει από το CDN — περιμένουμε να αποδοθεί.
    await p.locator('iframe').first().waitFor({ timeout: 30000 }).catch(() => {});
    await pause(p, 6000);
    await shot(p, 's04', '1-document-fields');
    await scrollBy(p, 450); await shot(p, 's04', '2-checks');
    await scrollBy(p, 600); await shot(p, 's04', '3-lines');
    await scrollBy(p, 600); await shot(p, 's04', '4-more');
  } },
  { id: 's05', name: 'new-traders', run: async (p) => {
    await go(p, '/admin/ocr/new-traders');
    await pause(p, 2500);
    await shot(p, 's05', '1-queue');
    await scrollBy(p, 500); await shot(p, 's05', '2-queue-more');
  } },
  { id: 's06', name: 'new-items', run: async (p) => {
    await go(p, '/admin/ocr/new-items');
    await pause(p, 3000);
    await shot(p, 's06', '1-queue');
    await scrollBy(p, 500); await shot(p, 's06', '2-panel');
  } },
  { id: 's05b', name: 'foreign-issuer', run: async (p) => {
    await go(p, `/admin/ocr/${DOC_FOREIGN}`);
    await p.locator('iframe').first().waitFor({ timeout: 30000 }).catch(() => {});
    await pause(p, 5000);
    await shot(p, 's05b', '1-foreign-doc');
    await hover(p, byRole(p, 'button', /Έλεγχος ΑΦΜ \(VIES\)/), 1800).catch(() => {});
    await shot(p, 's05b', '2-vies-button');
    await go(p, '/admin/traders?type=12');
    await click(p, byRole(p, 'button', /Ενέργειες για Azelis/), 1200).catch(() => {});
    await shot(p, 's05b', '3-trader-menu');
    await p.keyboard.press('Escape'); await pause(p, 600);
  } },
  { id: 's06b', name: 'item-panel', run: async (p) => {
    await go(p, '/admin/ocr/new-items');
    await pause(p, 3000);
    // Επιλογή της πρώτης ομάδας της ουράς (μόνο επιλογή — καμία δημιουργία).
    const row = p.locator('[role="option"], [data-queue-row], ul li button').first();
    await click(p, row, 2500).catch(() => {});
    await shot(p, 's06b', '1-item-panel');
    await scrollBy(p, 500); await shot(p, 's06b', '2-units');
    await scrollBy(p, 500); await shot(p, 's06b', '3-more');
  } },
  { id: 's07', name: 'lines', run: async (p) => {
    await go(p, `/admin/ocr/${DOC_ASSET}`);
    await p.locator('iframe').first().waitFor({ timeout: 30000 }).catch(() => {});
    await pause(p, 5000);
    await shot(p, 's07', '1-document');
    await scrollBy(p, 900); await shot(p, 's07', '2-lines');
    await scrollBy(p, 600); await shot(p, 's07', '3-lines-more');
  } },
  { id: 's08', name: 'posting', run: async (p) => {
    await go(p, `/admin/ocr/${DOC_OPEN}`);
    await pause(p, 3000);
    await hover(p, byRole(p, 'button', /Καταχώριση στη SoftOne/), 1800).catch(() => {});
    await shot(p, 's08', '1-action-bar');
    await go(p, `/admin/ocr/${DOC_POSTED}`);
    await pause(p, 3000);
    await hover(p, byText(p, 'Καταχωρήθηκε'), 1800).catch(() => {});
    await shot(p, 's08', '2-posted');
  } },
  { id: 's09', name: 'delivery-note', run: async (p) => {
    await go(p, `/admin/ocr/${DOC_OPEN}`);
    await pause(p, 2500);
    await click(p, byRole(p, 'button', /Από δελτίο αποστολής/), 1500);
    await p.getByText(/Ανοιχτά δελτία|Δεν βρέθηκε ανοιχτό/).first().waitFor({ timeout: 90000 }).catch(() => {});
    await pause(p, 1500);
    await shot(p, 's09', '1-dialog');
    await p.keyboard.press('Escape'); await pause(p, 800);
  } },
  { id: 's10', name: 'pending-posted', run: async (p) => {
    await go(p, '/admin/ocr/pending');
    await shot(p, 's10', '1-pending');
    await scrollBy(p, 500); await shot(p, 's10', '2-pending-groups');
    await go(p, '/admin/ocr/posted');
    await shot(p, 's10', '3-posted');
    await scrollBy(p, 500); await shot(p, 's10', '4-posted-days');
  } },
  { id: 's11', name: 'templates', run: async (p) => {
    await go(p, '/admin/ocr/templates');
    await shot(p, 's11', '1-templates');
    await go(p, `/admin/ocr/templates/${TEMPLATE}`);
    await pause(p, 3000);
    await shot(p, 's11', '2-template-regions');
    await scrollBy(p, 600); await shot(p, 's11', '3-template-more');
    await go(p, '/admin/ocr/templates/jobs');
    await shot(p, 's11', '4-jobs');
  } },
  { id: 's12', name: 'registries', run: async (p) => {
    await go(p, '/admin/traders?type=12');
    await shot(p, 's12', '1-traders');
    await click(p, byRole(p, 'button', new RegExp(`Ενέργειες για ${TRADER_ROW}`)), 1200);
    await shot(p, 's12', '2-actions-menu');
    await click(p, byRole(p, 'menuitem', /Εξακρίβωση ΑΑΔΕ/), 1500);
    await p.getByText(/Σύγκριση με ΑΑΔΕ/).first().waitFor({ timeout: 90000 }).catch(() => {});
    await pause(p, 1500);
    await shot(p, 's12', '3-aade-compare');
    // Εφαρμογή στη ΦΟΡΜΑ (τοπικά) + προεπισκόπηση (dry-run) — ΚΑΜΙΑ αποθήκευση.
    const apply = byRole(p, 'button', /Εφαρμογή \d+ στη φόρμα/);
    if (await apply.isVisible().catch(() => false)) {
      await click(p, apply, 1200);
      await click(p, byRole(p, 'button', /Προεπισκόπηση αλλαγών/), 2500);
      await p.locator('[data-slot="dialog-body"]').first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })).catch(() => {});
      await pause(p, 1500);
      await shot(p, 's12', '4-preview');
    }
    await p.keyboard.press('Escape'); await pause(p, 900);
    await go(p, '/admin/items'); await shot(p, 's12', '5-items');
    await go(p, '/admin/doc-series'); await shot(p, 's12', '6-doc-series');
  } },
  { id: 's13', name: 'accounting', run: async (p) => {
    await go(p, '/admin/softone/accounts'); await shot(p, 's13', '1-accounts');
    await go(p, '/admin/accounting/questions'); await shot(p, 's13', '2-questions');
    await go(p, '/admin/accounting/integrator'); await shot(p, 's13', '3-integrator');
  } },
  { id: 's14', name: 'settings-roles', run: async (p) => {
    await go(p, '/admin/settings');
    await hover(p, byText(p, 'Αρχικοποίηση εφαρμογής'), 1500).catch(() => {});
    await shot(p, 's14', '1-setup');           // ΜΟΝΟ η κορυφή — όχι «Διασυνδέσεις»
    await go(p, '/admin/roles'); await shot(p, 's14', '2-roles');
    await go(p, '/admin/permissions'); await shot(p, 's14', '3-permissions');
  } },
  { id: 's15', name: 'wiki', run: async (p) => {
    await go(p, '/wiki'); await shot(p, 's15', '1-wiki');
    await go(p, '/wiki/ocr/new-traders'); await shot(p, 's15', '2-page');
    await scrollBy(p, 700); await shot(p, 's15', '3-steps');
  } },
  { id: 's16', name: 'closing', run: async (p) => {
    await go(p, '/admin');
    await pause(p, 2500);
    await shot(p, 's16', '1-dashboard');
  } },
];

async function main() {
  const { chromium } = await import('@playwright/test');
  const raw = process.env.WIKI_USER_SUPER_ADMIN ?? '';
  const sep = raw.indexOf(':');
  if (sep < 0) throw new Error('Λείπει WIKI_USER_SUPER_ADMIN=email:password στο .env');
  const browser = await chromium.launch({ channel: 'chromium' });

  // Σύνδεση μία φορά — οι σκηνές ξεκινούν συνδεδεμένες (storage state).
  const authCtx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'el-GR' });
  const ap = await authCtx.newPage();
  await ap.goto(`${BASE}/auth/signin`);
  await ap.fill('input[name="email"]', raw.slice(0, sep));
  await ap.fill('input[name="password"]', raw.slice(sep + 1));
  await ap.click('button[type="submit"]');
  await ap.waitForURL((u) => !u.toString().includes('/auth/signin'), { timeout: 20000 });
  const state = await authCtx.storageState();
  await authCtx.close();

  const done = [];
  for (const s of SCENES) {
    if (only && !only.has(s.id)) continue;
    console.log(`▶ ${s.id} ${s.name}`);
    const vdir = path.join(OUT, '_raw', s.id);
    fs.mkdirSync(vdir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: W, height: H }, locale: 'el-GR', storageState: state,
      recordVideo: { dir: vdir, size: { width: W, height: H } },
    });
    await ctx.addInitScript(CURSOR_JS);
    const page = await ctx.newPage();
    mouse = { x: W / 2, y: H / 2 };
    let ok = true;
    try { await s.run(page); await pause(page, 1200); }
    catch (e) { ok = false; console.error(`  ✗ ${s.id}: ${e.message}`); }
    const video = page.video();
    await ctx.close();
    const webm = video ? await video.path() : null;
    if (webm && fs.existsSync(webm)) {
      const mp4 = path.join(OUT, `${s.id}-${s.name}.mp4`);
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
        console.log(`  🎬 ${path.relative(ROOT, mp4)}`);
      } catch { fs.copyFileSync(webm, mp4.replace(/\.mp4$/, '.webm')); }
    }
    done.push({ ...s, ok });
  }
  await browser.close();
  fs.rmSync(path.join(OUT, '_raw'), { recursive: true, force: true });
  console.log(`\nΈτοιμο: ${done.filter((d) => d.ok).length}/${done.length} σκηνές → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
