#!/usr/bin/env node
/**
 * Rough cut του video παρουσίασης από τις λήψεις του `capture.mjs`.
 *
 *  - ΠΛΗΡΗΣ: κάθε σκηνή με κομμένες αναμονές (freezedetect), κάρτα κεφαλαίου και τα κείμενα οθόνης
 *    του σεναρίου (docs/marketing/video-parousiasi-efarmogis.md §6).
 *  - TEASER: από τα screenshots, αργό zoom και ένα κείμενο ανά πλάνο (§7).
 *  - Υπότιτλοι .vtt με τους ίδιους χρόνους.
 *
 * Τα κείμενα αποδίδονται ως διάφανα PNG από Chromium (Inter, στρογγυλεμένα πλαίσια) και μπαίνουν
 * με ffmpeg overlay — το ffmpeg του συστήματος δεν έχει drawtext.
 * ΠΡΟΧΕΙΡΟ: φέρει υδατογράφημα «Πρόχειρο — εσωτερική χρήση». Το θόλωμα των προσωπικών δεδομένων
 * γίνεται στο τελικό μοντάζ (το περιεχόμενο κυλά — σταθερά κουτιά θολώματος δεν είναι αξιόπιστα).
 *
 * Χρήση: node scripts/video/rough-cut.mjs [--dir marketing-captures/2026-10-16]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const dirArg = (() => { const i = args.indexOf('--dir'); return i >= 0 ? args[i + 1] : null; })();
const SRC = path.resolve(ROOT, dirArg ?? path.join('marketing-captures', fs.readdirSync(path.join(ROOT, 'marketing-captures')).filter((d) => /^\d{4}-/.test(d)).sort().pop()));
const OUT = path.join(SRC, 'rough-cut');
const TMP = path.join(OUT, '_tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const W = 1920, H = 1080, FPS = 30;
// --final: χωρίς υδατογράφημα «Πρόχειρο», ονόματα αρχείων χωρίς «PROXEIRO».
const FINAL = args.includes('--final');
const SUFFIX = FINAL ? '' : '-PROXEIRO';
// B-roll από τη βιβλιοθήκη video (αλλάζει με BROLL_DIR / BROLL_DIR2).
const MOVIES = process.env.BROLL_DIR ?? '/Users/kozyris/Movies';
const MOVIES2 = process.env.BROLL_DIR2 ?? '/Volumes/home/DOWNLOADS/Videos';
const BROLL = {
  logo: path.join(MOVIES, 'DGsoft Globe Hero.mp4'),
  courier: path.join(MOVIES, 'courier_01.mp4'),
  office: path.join(MOVIES2, 'dgsoft', 'woman-wearing-blue-business-suite-working-at-the-o-2025-08-28-20-07-20-utc.mp4'),
  bg: path.join(MOVIES, 'dg_bg_1.mp4'),
  team: path.join(MOVIES, 'erp02.mp4'),
};

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { maxBuffer: 1 << 26 });
const probeDur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

// ── Σενάριο: σκηνές, κεφάλαια και κείμενα (από τις οδηγίες) ─────────────────────────────
// Κείμενα: ΠΗΓΗ το docs/marketing/video-keimena.md — ίδια λέξη-λέξη.
const SCENES = [
  { file: 's01-dashboard', ch: '1 · Dashboard', texts: [
    'Από την πρώτη οθόνη: τι ήρθε, τι διαβάστηκε, τι πέρασε στη SoftOne.',
    'Δίπλα σε κάθε αριθμό, η μεταβολή από την προηγούμενη περίοδο.',
    'Ό,τι περιμένει εσάς, συγκεντρωμένο σε μία λίστα.'] },
  { file: 's02-navigation', ch: '2 · Πλοήγηση', texts: [
    'Έγγραφα, μητρώα, λογιστική, ρυθμίσεις — σε ένα μενού.',
    'Οι αριθμοί στο μενού δείχνουν τι περιμένει ενέργεια.',
    'Σε κάθε σελίδα, το «?» ανοίγει οδηγό στα ελληνικά.'] },
  { file: 's03-upload', ch: '3 · Ανέβασμα', texts: [
    'Σύρετε PDF, σαρωμένα έγγραφα ή φωτογραφίες από το κινητό.',
    'Πολλά παραστατικά σε ένα PDF; Χωρίζονται αυτόματα.',
    'Για κάθε έγγραφο προτείνεται ο τύπος και η σειρά της SoftOne.'] },
  { file: 's04-document', ch: '4 · Ανάγνωση & έλεγχοι', texts: [
    'Εκδότης, αριθμός, ημερομηνία, γραμμές, ΦΠΑ, ΜΑΡΚ — διαβάζονται όλα.',
    'Ο προμηθευτής και τα είδη αναζητούνται απευθείας στη SoftOne.',
    'Λογαριασμός ρεύματος; Κάθε χρέωση πάει στον σωστό λογαριασμό.',
    'Το ίδιο τιμολόγιο δεν καταχωρείται ποτέ δύο φορές.'] },
  { file: 's05-new-traders', ch: '5 · Νέοι προμηθευτές', texts: [
    'Νέος προμηθευτής; Η καρτέλα του φτιάχνεται από τα στοιχεία της ΑΑΔΕ.',
    'Άδεια ουρά σημαίνει ότι όλοι οι εκδότες υπάρχουν ήδη στη SoftOne.'] },
  { file: 's05b-foreign-issuer', ch: '5β · Ξένοι προμηθευτές', texts: [
    'Ξένος προμηθευτής: χώρα και πρόθεμα ΑΦΜ από τη διεύθυνση του τιμολογίου.',
    'Έλεγχος VIES με επίσημο αριθμό ελέγχου — δωρεάν.'] },
  { file: 's06-new-items', ch: '6 · Είδη & έξοδα', texts: [
    'Κάθε γραμμή βρίσκει το είδος της στη SoftOne — ή σας προτείνεται.',
    'Η εφαρμογή θυμάται κάθε αντιστοίχιση: την επόμενη φορά γίνεται μόνη της.'] },
  { file: 's07-lines', ch: '7 · Γραμμές & πάγια', texts: [
    'Δεν χρειάζονται λογιστικές γνώσεις: διαλέγετε τι αφορά η αγορά.',
    'Μία δαπάνη σε πολλούς λογαριασμούς, με ποσοστό ή ποσό.',
    'Αγοράσατε υπολογιστή; Μπαίνει στα πάγια, όχι στα έξοδα.'] },
  { file: 's08-posting', ch: '8 · Καταχώριση', texts: [
    'Πριν την καταχώριση, η εφαρμογή σας λέει τι λείπει.',
    'Έλεγχος διπλοτύπου, τη στιγμή που πατάτε «Καταχώριση».',
    'Μετά, η SoftOne διαβάζεται ξανά — για να επιβεβαιωθεί.'] },
  { file: 's09-delivery-note', ch: '9 · Από δελτίο σε τιμολόγιο', texts: [
    'Το τιμολόγιο ήρθε μετά το δελτίο; Συγκρίνονται γραμμή-γραμμή.',
    'Με ένα κλικ, το δελτίο γίνεται τιμολόγιο και κλείνει στη SoftOne.'] },
  { file: 's10-pending-posted', ch: '10 · Εκκρεμότητες & αναρτημένα', texts: [
    'Ό,τι εκκρεμεί, ομαδοποιημένο ανά αιτία — με τη λύση δίπλα.',
    'Ό,τι καταχωρήθηκε, με τον αριθμό της SoftOne και την αξία του.'] },
  { file: 's11-templates', ch: '11 · Πρότυπα', texts: [
    'Τα δικά σας έντυπα: ορίζετε μία φορά τι διαβάζεται και πού.',
    'Η εφαρμογή μαθαίνει από δείγματα και βαθμολογεί κάθε πεδίο.',
    'Πολλά αρχεία μαζί, με ένα πρότυπο — αποτελέσματα σε Excel.'] },
  { file: 's12-registries', ch: '12 · Μητρώα', texts: [
    'Πελάτες, προμηθευτές, είδη, σειρές της SoftOne — με αναζήτηση.',
    'Διορθώνετε έναν προμηθευτή με σύγκριση από την ΑΑΔΕ — βλέπετε τι αλλάζει πριν αποθηκεύσετε.',
    'Είδη, υπηρεσίες και σειρές, ενημερωμένα από τη SoftOne.'] },
  { file: 's13-accounting', ch: '13 · Λογιστική', texts: [
    'Ο λογιστής απαντά μία φορά — η απάντηση εφαρμόζεται σε κάθε τιμολόγιο.',
    'Ό,τι πρέπει να ρυθμιστεί στη SoftOne, σε μία αναφορά για τον τεχνικό.'] },
  { file: 's14-settings-roles', ch: '14 · Ρυθμίσεις & ρόλοι', texts: [
    'Οι κανόνες σας ορίζονται μία φορά, στο στήσιμο.',
    'Κάθε χρήστης βλέπει και κάνει μόνο ό,τι επιτρέπει ο ρόλος του.'] },
  { file: 's15-wiki', ch: '15 · Οδηγός', texts: ['Οδηγός χρήστη στα ελληνικά, για κάθε οθόνη.'] },
];
const MOTTO = 'Σύρετε. Ελέγχετε. Καταχωρείτε.';
const INTRO = ['Κάθε τιμολόγιο αγοράς, στη SoftOne — χωρίς πληκτρολόγηση.', MOTTO];
const TEASER_INTRO = ['Τα τιμολόγια αγορών σας, στη SoftOne — χωρίς πληκτρολόγηση.', MOTTO];
const OUTRO = [MOTTO, 'Ζητήστε παρουσίαση με τα δικά σας τιμολόγια.'];
// Ενιαίο video: το πρόβλημα (b-roll) → teaser → γέφυρα → αναλυτική → κλείσιμο (b-roll).
const PROBLEM = ['Κάθε παραλαβή φέρνει ένα δελτίο ή τιμολόγιο.', '…που κάποιος πληκτρολογεί, γραμμή-γραμμή, στη SoftOne.'];
const BRIDGE = 'Δείτε πώς λειτουργεί, βήμα-βήμα.';
const CLOSING = 'Λιγότερη πληκτρολόγηση. Λιγότερα λάθη. Περισσότερος χρόνος για τη δουλειά σας.';
const TEASER = [
  { shot: 's03-2-dropzone', text: 'Σύρετε το τιμολόγιο — PDF, σάρωση ή φωτογραφία.', focus: [0.55, 0.55] },
  { shot: 's04-1-document-fields', text: 'Διαβάζονται όλα: εκδότης, γραμμές, ΦΠΑ, ΜΑΡΚ.', focus: [0.7, 0.7] },
  { shot: 's04-2-checks', text: 'Ελέγχεται απευθείας στη SoftOne, πριν καταχωρηθεί.', focus: [0.5, 0.35] },
  { shot: 's12-3-aade-compare', text: 'Τα στοιχεία του προμηθευτή, από την ΑΑΔΕ.', focus: [0.5, 0.35] },
  { shot: 's11-2-template-regions', text: 'Τα δικά σας έντυπα; Η εφαρμογή τα μαθαίνει.', focus: [0.5, 0.5] },
  { shot: 's08-2-posted', text: 'Καταχωρήθηκε — και επιβεβαιώθηκε στη SoftOne.', focus: [0.8, 0.95] },
  { shot: 's01-1-kpis', text: 'Όλη η εικόνα των αγορών σας, σε μία οθόνη.', focus: [0.5, 0.3] },
];

const textDur = (t) => Math.min(6, Math.max(2.6, t.length / 12));

// ── Γραφικά (HTML → PNG με διαφάνεια) ───────────────────────────────────────────────────
const FONT = `'Inter Display','Inter','SF Pro Display',-apple-system,'Helvetica Neue',Arial,sans-serif`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lowerThird = (t) => `<div style="position:absolute;left:0;right:0;bottom:72px;display:flex;justify-content:center">
  <div style="max-width:1280px;background:rgba(14,22,38,.88);color:#fff;border-radius:16px;padding:20px 30px;font:500 34px/1.32 ${FONT};
  box-shadow:0 10px 30px rgba(0,0,0,.28);border-left:6px solid #2563eb;letter-spacing:-.2px">${esc(t)}</div></div>`;
const card = (title, sub = '') => `<div style="position:absolute;inset:0;background:radial-gradient(1200px 700px at 30% 30%,#18284a,#0E1626);display:flex;flex-direction:column;justify-content:center;padding:0 160px">
  <div style="width:72px;height:6px;border-radius:3px;background:#d4213d;margin-bottom:30px"></div>
  <div style="color:#fff;font:700 64px/1.15 ${FONT};letter-spacing:-1px">${esc(title)}</div>
  ${sub ? `<div style="color:#b6c3dc;font:400 34px/1.35 ${FONT};margin-top:22px;max-width:1400px">${esc(sub)}</div>` : ''}</div>`;
const heroText = (t) => `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,22,38,0) 35%,rgba(14,22,38,.78) 100%)"></div>
  <div style="position:absolute;left:160px;right:160px;bottom:120px;color:#fff;font:700 58px/1.18 ${FONT};letter-spacing:-.8px;text-shadow:0 4px 24px rgba(0,0,0,.45)">${esc(t)}</div>`;
const cardOver = (title, sub = '') => `<div style="position:absolute;inset:0;background:rgba(14,22,38,.62);display:flex;flex-direction:column;justify-content:center;padding:0 160px">
  <div style="width:72px;height:6px;border-radius:3px;background:#d4213d;margin-bottom:30px"></div>
  <div style="color:#fff;font:700 64px/1.15 ${FONT};letter-spacing:-1px;text-shadow:0 4px 24px rgba(0,0,0,.4)">${esc(title)}</div>
  ${sub ? `<div style="color:#dbe4f5;font:400 34px/1.35 ${FONT};margin-top:22px;max-width:1400px">${esc(sub)}</div>` : ''}</div>`;
const watermark = `<div style="position:absolute;top:22px;right:26px;background:rgba(212,33,61,.9);color:#fff;border-radius:8px;padding:6px 12px;font:600 18px ${FONT}">Πρόχειρο — εσωτερική χρήση</div>`;

async function renderPngs(jobs) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const j of jobs) {
    await page.setContent(`<html><body style="margin:0;background:transparent;width:${W}px;height:${H}px;position:relative">${j.html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: j.out, omitBackground: true });
  }
  await browser.close();
}

// ── Κόψιμο αναμονών: κάθε «παγωμένο» διάστημα > 2″ γίνεται 1,2″ ─────────────────────────────
function keepRanges(file) {
  const dur = probeDur(file);
  // Το ffmpeg γράφει τα αποτελέσματα του freezedetect στο stderr.
  const all = execFileSync('bash', ['-c', `ffmpeg -hide_banner -i "${file}" -vf freezedetect=n=0.003:d=2 -map 0:v:0 -f null - 2>&1 || true`], { maxBuffer: 1 << 26 }).toString();
  const starts = [...all.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...all.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const keep = [];
  let cur = 0;
  starts.forEach((s, i) => {
    const e = ends[i] ?? dur;
    keep.push([cur, Math.min(e, s + 1.2)]);
    cur = e;
  });
  keep.push([cur, dur]);
  return keep.filter(([a, b]) => b - a > 0.05);
}

function trimScene(file, out) {
  const ranges = keepRanges(file);
  const expr = ranges.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
  ff('-i', file, '-vf', `select='${expr}',setpts=N/FRAME_RATE/TB,fps=${FPS}`, '-an', ...ENC, out);
  return probeDur(out);
}

// Κείμενα πάνω σε clip: διαδοχικά από 0,8″· αν δεν χωρούν, το clip «παγώνει» στο τέλος.
function overlayTexts(clip, clipDur, pngs, texts, out, offset, cues) {
  let t = 0.8;
  const sched = texts.map((tx) => { const d = textDur(tx); const s = t; t += d + 0.35; return { s, d, tx }; });
  const need = t + 0.4;
  const pad = Math.max(0, need - clipDur);
  const inputs = ['-i', clip];
  sched.forEach((x, i) => inputs.push('-loop', '1', '-t', x.d.toFixed(2), '-i', pngs[i]));
  let f = `[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}[v0]`;
  sched.forEach((x, i) => {
    f += `;[${i + 1}:v]format=rgba,fade=in:st=0:d=0.25:alpha=1,fade=out:st=${(x.d - 0.25).toFixed(2)}:d=0.25:alpha=1,setpts=PTS+${x.s.toFixed(2)}/TB[t${i}]`;
    f += `;[v${i}][t${i}]overlay=0:0:eof_action=pass:enable='between(t,${x.s.toFixed(2)},${(x.s + x.d).toFixed(2)})'[v${i + 1}]`;
    cues.push({ start: offset + x.s, end: offset + x.s + x.d, text: x.tx });
  });
  ff(...inputs, '-filter_complex', f, '-map', `[v${sched.length}]`, ...ENC, out);
  return probeDur(out);
}

function stillClip(png, dur, out, { zoom = false, focus = [0.5, 0.5] } = {}) {
  const frames = Math.round(dur * FPS);
  const fade = `fade=in:st=0:d=0.3,fade=out:st=${(dur - 0.3).toFixed(2)}:d=0.3`;
  if (zoom) {
    // ΜΙΑ εικόνα εισόδου: το zoompan βγάζει `d` καρέ ανά καρέ εισόδου (με -loop θα πολλαπλασιαζόταν).
    ff('-i', png, '-vf', `scale=${W * 2}:${H * 2},zoompan=z='min(1+0.0009*on,1.12)':x='iw*${focus[0]}-iw/zoom*${focus[0]}':y='ih*${focus[1]}-ih/zoom*${focus[1]}':d=${frames}:s=${W}x${H}:fps=${FPS},${fade}`, '-frames:v', String(frames), ...ENC, out);
  } else {
    ff('-loop', '1', '-t', dur.toFixed(2), '-i', png, '-vf', `fps=${FPS},${fade}`, ...ENC, out);
  }
}

/** Κομμάτι από b-roll: γεμίζει 1920×1080, ελαφρώς σκουρότερο, fade, χωρίς ήχο· προαιρετικά γραφικό από πάνω. */
function brollClip(src, start, dur, out, overlayPng = null) {
  const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,eq=brightness=-0.04:saturation=0.95,fade=in:st=0:d=0.4,fade=out:st=${(dur - 0.4).toFixed(2)}:d=0.4`;
  if (!overlayPng) { ff('-ss', String(start), '-t', dur.toFixed(2), '-i', src, '-vf', base, '-an', ...ENC, out); return; }
  ff('-ss', String(start), '-t', dur.toFixed(2), '-i', src, '-loop', '1', '-t', dur.toFixed(2), '-i', overlayPng,
    '-filter_complex', `[0:v]${base}[b];[1:v]format=rgba,fade=in:st=0.3:d=0.4:alpha=1,fade=out:st=${(dur - 0.45).toFixed(2)}:d=0.35:alpha=1[o];[b][o]overlay=0:0:shortest=1`,
    '-an', ...ENC, out);
}

const vttTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; };
const writeVtt = (cues, file) => fs.writeFileSync(file, 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n'));

function concat(parts, out) {
  const list = path.join(TMP, `${path.basename(out)}.txt`);
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  if (FINAL) { ff('-f', 'concat', '-safe', '0', '-i', list, ...ENC, '-movflags', '+faststart', out); return; }
  const wm = path.join(TMP, 'watermark.png');
  // Το υδατογράφημα σε ΟΛΗ τη διάρκεια: εικόνα σε επανάληψη, τέλος με το video.
  ff('-f', 'concat', '-safe', '0', '-i', list, '-loop', '1', '-i', wm, '-filter_complex', '[1:v]format=rgba[w];[0:v][w]overlay=0:0:shortest=1', ...ENC, '-movflags', '+faststart', out);
}

async function main() {
  const scenes = SCENES.filter((s) => fs.existsSync(path.join(SRC, `${s.file}.mp4`)));
  const jobs = [{ html: watermark, out: path.join(TMP, 'watermark.png') },
    { html: card(INTRO[0], INTRO[1]), out: path.join(TMP, 'intro.png') },
    { html: card(TEASER_INTRO[0], TEASER_INTRO[1]), out: path.join(TMP, 'teaser-intro.png') },
    { html: card(OUTRO[0], OUTRO[1]), out: path.join(TMP, 'outro.png') },
    { html: heroText(PROBLEM[0]), out: path.join(TMP, 'pr-0.png') },
    { html: heroText(PROBLEM[1]), out: path.join(TMP, 'pr-1.png') },
    { html: cardOver(BRIDGE), out: path.join(TMP, 'bridge.png') },
    { html: heroText(CLOSING), out: path.join(TMP, 'closing.png') },
    { html: cardOver(OUTRO[0], OUTRO[1]), out: path.join(TMP, 'outro-over.png') }];
  scenes.forEach((s, si) => {
    jobs.push({ html: card(s.ch), out: path.join(TMP, `ch-${si}.png`) });
    s.texts.forEach((t, ti) => jobs.push({ html: lowerThird(t), out: path.join(TMP, `tx-${si}-${ti}.png`) }));
  });
  TEASER.forEach((t, i) => jobs.push({ html: lowerThird(t.text), out: path.join(TMP, `tt-${i}.png`) }));
  console.log(`🖌  ${jobs.length} γραφικά`);
  await renderPngs(jobs);

  // ── Πλήρης ──
  const parts = [];
  const cues = [];
  let t = 0;
  const intro = path.join(TMP, 'intro.mp4'); stillClip(path.join(TMP, 'intro.png'), 4.5, intro); parts.push(intro);
  cues.push({ start: 0.3, end: 4.2, text: `${INTRO[0]} ${INTRO[1]}` }); t += probeDur(intro);
  scenes.forEach((s, si) => {
    console.log(`✂  ${s.file}`);
    const chap = path.join(TMP, `ch-${si}.mp4`); stillClip(path.join(TMP, `ch-${si}.png`), 1.8, chap); parts.push(chap); t += probeDur(chap);
    const trimmed = path.join(TMP, `trim-${si}.mp4`);
    const d = trimScene(path.join(SRC, `${s.file}.mp4`), trimmed);
    const withText = path.join(TMP, `scene-${si}.mp4`);
    const d2 = overlayTexts(trimmed, d, s.texts.map((_, ti) => path.join(TMP, `tx-${si}-${ti}.png`)), s.texts, withText, t, cues);
    parts.push(withText); t += d2;
  });
  const outro = path.join(TMP, 'outro.mp4'); stillClip(path.join(TMP, 'outro.png'), 4.5, outro); parts.push(outro);
  cues.push({ start: t + 0.3, end: t + 4.2, text: `${OUTRO[0]} ${OUTRO[1]}` });
  const fullBody = parts.slice(1, -1);                    // χωρίς άνοιγμα/κλείσιμο — για το ενιαίο
  const fullBodyStart = probeDur(intro), fullBodyEnd = t;
  const fullBodyCues = cues.filter((c) => c.start >= fullBodyStart && c.end <= fullBodyEnd).map((c) => ({ ...c, start: c.start - fullBodyStart, end: c.end - fullBodyStart }));
  const full = path.join(OUT, `dgespa-parousiasi-full${SUFFIX}.mp4`);
  console.log('🎬 πλήρης…'); concat(parts, full);
  writeVtt(cues, path.join(OUT, 'dgespa-parousiasi.el.vtt'));

  // ── Teaser ──
  const tparts = []; const tcues = []; let tt = 0;
  const tIntro = path.join(TMP, 't-intro.mp4'); stillClip(path.join(TMP, 'teaser-intro.png'), 3.5, tIntro); tparts.push(tIntro); tt += probeDur(tIntro);
  TEASER.forEach((x, i) => {
    const png = path.join(SRC, `${x.shot}.png`);
    if (!fs.existsSync(png)) return;
    const base = path.join(TMP, `t-${i}.mp4`); stillClip(png, 6.5, base, { zoom: true, focus: x.focus });
    const withText = path.join(TMP, `t-${i}-txt.mp4`);
    tt += overlayTexts(base, probeDur(base), [path.join(TMP, `tt-${i}.png`)], [x.text], withText, tt, tcues);
    tparts.push(withText);
  });
  const tOutro = path.join(TMP, 't-outro.mp4'); stillClip(path.join(TMP, 'outro.png'), 3.5, tOutro);
  const teaserBody = tparts.slice();                      // άνοιγμα + πλάνα — χωρίς το κλείσιμο
  const teaserBodyDur = tt;
  tparts.push(tOutro);
  const teaser = path.join(OUT, `dgespa-teaser${SUFFIX}.mp4`);
  console.log('🎬 teaser…'); concat(tparts, teaser);
  writeVtt(tcues, path.join(OUT, 'dgespa-teaser.el.vtt'));

  // ── Ενιαίο: πρόβλημα → teaser → γέφυρα → αναλυτική → κλείσιμο ──
  let combined = null;
  if (Object.values(BROLL).every((f) => fs.existsSync(f))) {
    console.log('🎬 ενιαίο…');
    const c = []; const ccues = []; let ct = 0;
    const add = (file, rel = []) => { rel.forEach((x) => ccues.push({ ...x, start: x.start + ct, end: x.end + ct })); c.push(file); ct += probeDur(file); };
    const logo = path.join(TMP, 'b-logo.mp4'); brollClip(BROLL.logo, 0, 4.5, logo); add(logo);
    const p0 = path.join(TMP, 'b-pr0.mp4'); brollClip(BROLL.courier, 2, 4.2, p0, path.join(TMP, 'pr-0.png')); add(p0, [{ start: 0.4, end: 3.9, text: PROBLEM[0] }]);
    const p1 = path.join(TMP, 'b-pr1.mp4'); brollClip(BROLL.office, 3, 4.5, p1, path.join(TMP, 'pr-1.png')); add(p1, [{ start: 0.4, end: 4.2, text: PROBLEM[1] }]);
    let tAcc = 0;
    teaserBody.forEach((f) => { const d = probeDur(f); add(f, tcues.filter((x) => x.start >= tAcc && x.end <= tAcc + d + 0.01).map((x) => ({ ...x, start: x.start - tAcc, end: x.end - tAcc }))); tAcc += d; });
    const br = path.join(TMP, 'b-bridge.mp4'); brollClip(BROLL.bg, 1, 3.2, br, path.join(TMP, 'bridge.png')); add(br, [{ start: 0.4, end: 2.9, text: BRIDGE }]);
    let fAcc = 0;
    fullBody.forEach((f) => { const d = probeDur(f); add(f, fullBodyCues.filter((x) => x.start >= fAcc && x.end <= fAcc + d + 0.01).map((x) => ({ ...x, start: x.start - fAcc, end: x.end - fAcc }))); fAcc += d; });
    const cl = path.join(TMP, 'b-closing.mp4'); brollClip(BROLL.team, 2, 4.5, cl, path.join(TMP, 'closing.png')); add(cl, [{ start: 0.4, end: 4.2, text: CLOSING }]);
    const oo = path.join(TMP, 'b-outro.mp4'); brollClip(BROLL.logo, 4, 5, oo, path.join(TMP, 'outro-over.png')); add(oo, [{ start: 0.4, end: 4.6, text: `${OUTRO[0]} ${OUTRO[1]}` }]);
    combined = path.join(OUT, `dgespa-parousiasi-oliki${SUFFIX}.mp4`);
    concat(c, combined);
    writeVtt(ccues, path.join(OUT, 'dgespa-parousiasi-oliki.el.vtt'));
  } else console.warn('⚠ λείπουν αρχεία b-roll — το ενιαίο video παραλείπεται');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nΈτοιμο → ${path.relative(ROOT, OUT)}\n  πλήρης ${probeDur(full).toFixed(0)}″ · teaser ${probeDur(teaser).toFixed(0)}″${combined ? ` · ενιαίο ${probeDur(combined).toFixed(0)}″` : ''}`);
}

main().catch((e) => { console.error(e?.stderr?.toString?.() || e); process.exit(1); });
