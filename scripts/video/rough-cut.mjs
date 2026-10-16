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

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { maxBuffer: 1 << 26 });
const probeDur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

// ── Σενάριο: σκηνές, κεφάλαια και κείμενα (από τις οδηγίες) ─────────────────────────────
const SCENES = [
  { file: 's01-dashboard', ch: '1 · Dashboard', texts: [
    'Με μια ματιά: πόσα έγγραφα ήρθαν, πόσα διαβάστηκαν, πόσα πέρασαν στη SoftOne.',
    'Κάθε δείκτης δείχνει και τη μεταβολή από την προηγούμενη περίοδο.',
    'Ό,τι χρειάζεται προσοχή, σε μία λίστα.'] },
  { file: 's02-navigation', ch: '2 · Πλοήγηση', texts: [
    'Όλα σε ένα μενού: έγγραφα, μητρώα, λογιστική, σύστημα.',
    'Οι αριθμοί δείχνουν τι περιμένει ενέργεια.',
    'Το “?” σε κάθε σελίδα ανοίγει τον οδηγό της.'] },
  { file: 's03-upload', ch: '3 · Ανέβασμα εγγράφων', texts: [
    'Σύρετε PDF, σαρωμένα έγγραφα ή φωτογραφίες.',
    'Μια στοίβα παραστατικών σε ένα PDF; Χωρίζεται αυτόματα.',
    'Η εφαρμογή αναγνωρίζει τον τύπο και τη σειρά του παραστατικού.'] },
  { file: 's04-document', ch: '4 · Η ανάγνωση και οι έλεγχοι', texts: [
    'Κάθε πεδίο διαβάζεται και ελέγχεται: ΑΦΜ, σύνολα, ΦΠΑ, ΜΑΡΚ.',
    'Ο προμηθευτής και τα είδη αναζητούνται απευθείας στη SoftOne.',
    'Λογαριασμοί ρεύματος, νερού, τηλεφώνου: κάθε γραμμή πάει στον σωστό λογαριασμό.',
    'Το ίδιο χαρτί δεν καταχωρείται δύο φορές.'] },
  { file: 's05-new-traders', ch: '5 · Νέοι συναλλασσόμενοι', texts: [
    'Ο εκδότης δεν υπάρχει στη SoftOne; Δημιουργείται από εδώ — με στοιχεία ΑΑΔΕ ή VIES.'] },
  { file: 's05b-foreign-issuer', ch: '5β · Ξένοι προμηθευτές', texts: [
    'Ξένος προμηθευτής: η χώρα και το πρόθεμα ΑΦΜ βρίσκονται από τη διεύθυνση.',
    'Έλεγχος VIES με επίσημο αριθμό ελέγχου — δωρεάν, απευθείας από την Ευρωπαϊκή Επιτροπή.'] },
  { file: 's06-new-items', ch: '6 · Είδη & έξοδα', texts: [
    'Κάθε γραμμή βρίσκει το είδος της στη SoftOne — ή προτείνεται.',
    'Η εφαρμογή θυμάται: την επόμενη φορά η αντιστοίχιση γίνεται μόνη της.'] },
  { file: 's07-lines', ch: '7 · Γραμμές: σκοπός, επιμερισμός, πάγια', texts: [
    'Χωρίς λογιστικές γνώσεις: διαλέγετε τι αφορά η αγορά.',
    'Μία δαπάνη, πολλοί λογαριασμοί — με ποσοστό ή ποσό.',
    'Αγορά παγίου; Καταχωρείται ως πάγιο.'] },
  { file: 's08-posting', ch: '8 · Καταχώριση στη SoftOne', texts: [
    'Η εφαρμογή λέει τι λείπει πριν καταχωρίσετε.',
    'Έλεγχος διπλοτύπου τη στιγμή της καταχώρισης.',
    'Καταχωρήθηκε — και επιβεβαιώθηκε με νέα ανάγνωση από τη SoftOne.'] },
  { file: 's09-delivery-note', ch: '9 · Από δελτίο αποστολής σε τιμολόγιο', texts: [
    'Το τιμολόγιο ήρθε μετά το δελτίο; Συγκρίνεται γραμμή-γραμμή με τα ανοιχτά δελτία.',
    'Ένα κλικ: το δελτίο γίνεται τιμολόγιο και κλείνει στη SoftOne.'] },
  { file: 's10-pending-posted', ch: '10 · Εκκρεμότητες & αναρτημένα', texts: [
    'Ό,τι περιμένει ενέργεια, ομαδοποιημένο ανά αιτία.',
    'Ό,τι καταχωρίστηκε, με τον κωδικό της SoftOne και την αξία.'] },
  { file: 's11-templates', ch: '11 · Πρότυπα & μαζική σάρωση', texts: [
    'Δικά σας έντυπα; Ορίζετε περιοχές και πεδία μία φορά.',
    'Η εφαρμογή μαθαίνει από δείγματα — με βαθμό ανά πεδίο.',
    'Εκατοντάδες αρχεία με ένα πρότυπο — αποτελέσματα σε Excel.'] },
  { file: 's12-registries', ch: '12 · Μητρώα SoftOne', texts: [
    'Τα μητρώα της SoftOne, γρήγορα και με αναζήτηση.',
    'Τροποποίηση με σύγκριση από την ΑΑΔΕ ή το VIES — βλέπετε τι αλλάζει πριν αποθηκεύσετε.',
    'Είδη, υπηρεσίες, σειρές παραστατικών — όλα σε ένα σημείο.'] },
  { file: 's13-accounting', ch: '13 · Λογιστική αρχικοποίηση', texts: [
    'Ο λογιστής απαντά μία φορά — η εφαρμογή το εφαρμόζει σε κάθε παραστατικό.',
    'Ό,τι πρέπει να ρυθμιστεί στη SoftOne, σε μία ζωντανή αναφορά.'] },
  { file: 's14-settings-roles', ch: '14 · Ρυθμίσεις, ρόλοι, ασφάλεια', texts: [
    'Οι κανόνες σας, μία φορά στο στήσιμο.',
    'Ρόλοι και δικαιώματα — ο καθένας βλέπει ό,τι του αναλογεί.'] },
  { file: 's15-wiki', ch: '15 · Οδηγός χρήστη', texts: ['Οδηγός χρήστη στα ελληνικά, για κάθε λειτουργία.'] },
];
const INTRO = ['Από το χαρτί στη SoftOne — χωρίς πληκτρολόγηση.', 'Αναγνώριση παραστατικών με AI, έλεγχοι και καταχώριση με ένα κλικ.'];
const OUTRO = ['Λιγότερη πληκτρολόγηση. Λιγότερα λάθη. Όλα στη SoftOne.', 'Ζητήστε demo'];
const TEASER = [
  { shot: 's03-2-dropzone', text: 'Σύρετε το τιμολόγιο.', focus: [0.55, 0.55] },
  { shot: 's04-1-document-fields', text: 'Το AI διαβάζει κάθε πεδίο.', focus: [0.7, 0.7] },
  { shot: 's04-2-checks', text: 'Έλεγχος με τη SoftOne σε πραγματικό χρόνο.', focus: [0.5, 0.35] },
  { shot: 's12-3-aade-compare', text: 'Νέος ή υπάρχων προμηθευτής — στοιχεία από την ΑΑΔΕ.', focus: [0.5, 0.35] },
  { shot: 's11-2-template-regions', text: 'Δικά σας έντυπα, με πρότυπα που μαθαίνουν.', focus: [0.5, 0.5] },
  { shot: 's08-2-posted', text: 'Καταχωρήθηκε στη SoftOne.', focus: [0.8, 0.95] },
  { shot: 's01-1-kpis', text: 'Όλη η εικόνα, σε ένα dashboard.', focus: [0.5, 0.3] },
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

const vttTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; };
const writeVtt = (cues, file) => fs.writeFileSync(file, 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n'));

function concat(parts, out) {
  const list = path.join(TMP, `${path.basename(out)}.txt`);
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const wm = path.join(TMP, 'watermark.png');
  // Το υδατογράφημα σε ΟΛΗ τη διάρκεια: εικόνα σε επανάληψη, τέλος με το video.
  ff('-f', 'concat', '-safe', '0', '-i', list, '-loop', '1', '-i', wm, '-filter_complex', '[1:v]format=rgba[w];[0:v][w]overlay=0:0:shortest=1', ...ENC, '-movflags', '+faststart', out);
}

async function main() {
  const scenes = SCENES.filter((s) => fs.existsSync(path.join(SRC, `${s.file}.mp4`)));
  const jobs = [{ html: watermark, out: path.join(TMP, 'watermark.png') },
    { html: card(INTRO[0], INTRO[1]), out: path.join(TMP, 'intro.png') },
    { html: card(OUTRO[0], OUTRO[1]), out: path.join(TMP, 'outro.png') }];
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
  const full = path.join(OUT, 'dgespa-parousiasi-full-PROXEIRO.mp4');
  console.log('🎬 πλήρης…'); concat(parts, full);
  writeVtt(cues, path.join(OUT, 'dgespa-parousiasi.el.vtt'));

  // ── Teaser ──
  const tparts = []; const tcues = []; let tt = 0;
  const tIntro = path.join(TMP, 't-intro.mp4'); stillClip(path.join(TMP, 'intro.png'), 3.5, tIntro); tparts.push(tIntro); tt += probeDur(tIntro);
  TEASER.forEach((x, i) => {
    const png = path.join(SRC, `${x.shot}.png`);
    if (!fs.existsSync(png)) return;
    const base = path.join(TMP, `t-${i}.mp4`); stillClip(png, 6.5, base, { zoom: true, focus: x.focus });
    const withText = path.join(TMP, `t-${i}-txt.mp4`);
    tt += overlayTexts(base, probeDur(base), [path.join(TMP, `tt-${i}.png`)], [x.text], withText, tt, tcues);
    tparts.push(withText);
  });
  const tOutro = path.join(TMP, 't-outro.mp4'); stillClip(path.join(TMP, 'outro.png'), 3.5, tOutro); tparts.push(tOutro);
  const teaser = path.join(OUT, 'dgespa-teaser-PROXEIRO.mp4');
  console.log('🎬 teaser…'); concat(tparts, teaser);
  writeVtt(tcues, path.join(OUT, 'dgespa-teaser.el.vtt'));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nΈτοιμο → ${path.relative(ROOT, OUT)}\n  πλήρης ${probeDur(full).toFixed(0)}″ · teaser ${probeDur(teaser).toFixed(0)}″`);
}

main().catch((e) => { console.error(e?.stderr?.toString?.() || e); process.exit(1); });
