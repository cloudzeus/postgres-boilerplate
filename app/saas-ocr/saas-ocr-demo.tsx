'use client';

import * as React from 'react';
import {
  FiUploadCloud, FiZap, FiCheckCircle, FiClock, FiMail, FiLink2, FiTrendingUp,
  FiFileText, FiTruck, FiBox, FiTool, FiPlay, FiShield, FiDatabase,
} from 'react-icons/fi';

// ---- mocked subscriber data (demo only — no backend) ----
const SAMPLE_FILES = [
  'ΤΙΜ_2024_0451.pdf', 'ENARTIA_invoice.pdf', 'ΔΕΗ_Μαρτιος.pdf', 'COSMOTE_0231.jpg',
  'Προμηθευτης_ΑΒΓ.pdf', 'ΓΚΑΖΗΣ_ΔΑ_882.pdf', 'scan_0099.jpg', 'ΕΥΔΑΠ_Q1.pdf',
  'invoice_quik.pdf', 'ΛΟΓΙΣΤΙΚΑ_ΥΠΗΡ.pdf', 'ΠΡΟΜ_4521.jpg', 'fuel_receipt.jpg',
];
const RESULTS = [
  { num: 'ΤΙΜΑ-451', supplier: 'ΓΚΑΖΗΣ ΔΗΜ. & ΣΙΑ Ε.Ε.', code: '130100', type: 'product', total: '€1.240,00', posted: true },
  { num: 'ΤΠΥ-0231', supplier: 'ENARTIA Α.Ε.', code: '332352', type: 'service', total: '€89,00', posted: true },
  { num: 'ΛΣ-9921', supplier: 'COSMOTE', code: '53.98.087', type: 'service', total: '€45,20', posted: true },
  { num: 'ΤΙΜ-7741', supplier: 'QlikTech Hellas', code: '149013', type: 'product', total: '€3.500,00', posted: false },
];

type Phase = 'idle' | 'uploading' | 'processing' | 'done';

export function SaasOcrDemo() {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [done, setDone] = React.useState(0);
  const TOTAL = 200;
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const start = () => {
    if (phase === 'processing' || phase === 'uploading') return;
    setDone(0); setPhase('uploading');
    setTimeout(() => {
      setPhase('processing');
      timer.current = setInterval(() => {
        setDone((d) => {
          const next = d + Math.floor(6 + Math.random() * 10); // ~concurrency 10
          if (next >= TOTAL) {
            if (timer.current) clearInterval(timer.current);
            setPhase('done');
            return TOTAL;
          }
          return next;
        });
      }, 200);
    }, 900);
  };
  React.useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const pct = Math.round((done / TOTAL) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0B1220] via-[#0E1626] to-[#0B1220] text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0B1220]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#E31E2A] text-[12px] font-bold">DG</span>
            <div>
              <p className="text-[14px] font-semibold leading-none">ParaStat <span className="text-white/50">Cloud</span></p>
              <p className="text-[10px] text-white/40">Λογιστικό Γραφείο «Demo» — Pro plan</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              ● SoftOne συνδεδεμένο
            </span>
            <span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[11px] sm:inline">demo@parastat.gr</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        {/* Hero */}
        <section className="text-center">
          <h1 className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Ανέβασε τα παραστατικά σου. Καταχωρούνται μόνα τους.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-[14px] text-white/55">
            OCR με AI + αυτόματη συσχέτιση προμηθευτών/ειδών + καταχώριση στο SoftOne. Εσύ ανεβάζεις τον φάκελο — εμείς κάνουμε τα υπόλοιπα και σου στέλνουμε email όταν ολοκληρωθεί.
          </p>
        </section>

        {/* KPI cards */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={<FiFileText />} value="3.184" label="Παραστατικά / μήνα" />
          <Kpi icon={<FiZap />} value="7.420" label="Σελίδες σκαναρισμένες" />
          <Kpi icon={<FiCheckCircle />} value="2.980" label="Αυτόματες καταχωρίσεις SoftOne" accent="#34D399" />
          <Kpi icon={<FiClock />} value="148 ώρες" label="Εξοικονόμηση / μήνα" accent="#60A5FA" />
        </section>

        {/* Upload + batch processing */}
        <section className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Φάκελος παραστατικών</h2>
                <p className="mt-0.5 text-[12px] text-white/45">Σύρε εικόνες & PDF — ή σύνδεσε Bunny / Drive φάκελο.</p>
              </div>
              <button onClick={start}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0078D4] px-3 py-2 text-[13px] font-semibold hover:bg-[#0a84e0] disabled:opacity-50"
                disabled={phase === 'processing' || phase === 'uploading'}>
                <FiPlay className="h-4 w-4" /> Demo: ανέβασε 200 σελίδες
              </button>
            </div>

            <div className={`mt-4 grid place-items-center rounded-xl border-2 border-dashed py-10 transition-colors ${
              phase === 'idle' ? 'border-white/15 bg-white/[0.02]' : 'border-[#0078D4]/40 bg-[#0078D4]/[0.06]'}`}>
              <FiUploadCloud className={`h-10 w-10 ${phase === 'idle' ? 'text-white/30' : 'text-[#60A5FA]'}`} />
              <p className="mt-2 text-[13px] text-white/60">
                {phase === 'idle' && 'Drag & drop ή πάτα «Demo»'}
                {phase === 'uploading' && 'Ανέβασμα στο Bunny CDN…'}
                {phase === 'processing' && `Επεξεργασία ${done}/${TOTAL} σελίδων… (concurrency 10)`}
                {phase === 'done' && 'Ολοκληρώθηκε ✓'}
              </p>
            </div>

            {/* progress */}
            {phase !== 'idle' && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[12px] text-white/55">
                  <span>{phase === 'done' ? 'Όλα έτοιμα' : 'Πρόοδος'}</span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#0078D4] to-[#34D399] transition-all duration-200" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_FILES.map((f, i) => {
                    const fileDone = (i + 1) / SAMPLE_FILES.length <= done / TOTAL || phase === 'done';
                    const active = !fileDone && (i / SAMPLE_FILES.length <= done / TOTAL);
                    return (
                      <span key={f} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${
                        fileDone ? 'bg-emerald-400/15 text-emerald-300'
                        : active ? 'bg-[#0078D4]/20 text-[#7cc4f7]'
                        : 'bg-white/5 text-white/40'}`}>
                        {fileDone ? <FiCheckCircle className="h-2.5 w-2.5" /> : active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
                        {f}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* email banner */}
            {phase === 'done' && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3">
                <FiMail className="h-5 w-5 text-emerald-300" />
                <div className="text-[12px]">
                  <p className="font-semibold text-emerald-200">Στάλθηκε email στον πελάτη</p>
                  <p className="text-white/50">«200 σελίδες ολοκληρώθηκαν — 188 ταυτοποιήθηκαν & καταχωρήθηκαν στο SoftOne».</p>
                </div>
              </div>
            )}
          </div>

          {/* SoftOne auto-post panel */}
          <div className="lg:col-span-2 space-y-3">
            <Panel title="Διασύνδεση SoftOne" icon={<FiDatabase />}>
              <Row label="Κατάσταση" value={<span className="text-emerald-300">● Online</span>} />
              <Row label="Token cache" value="30′ (auto-refresh)" />
              <Row label="Σειρά αγορών" value="ΤΙΜΑ · auto-number" />
              <Row label="Ουρά καταχώρισης" value="FIFO ανά εταιρία" />
            </Panel>
            <Panel title="Αυτόματη καταχώριση" icon={<FiLink2 />}>
              <Row label="Προμηθευτής (ΑΦΜ)" value={<span className="text-emerald-300">✓ ταυτοποίηση</span>} />
              <Row label="Είδη / Υπηρεσίες" value="CODE / εργοστασίου / EAN" />
              <Row label="Τύπος τιμολογίου" value="DeepSeek: υπηρ./προϊόν" />
              <Row label="Exactly-once" value="reconcile σε timeout" />
            </Panel>
          </div>
        </section>

        {/* Results */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Πρόσφατα αποτελέσματα</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th className="px-3 py-2 font-semibold">Παραστατικό</th>
                  <th className="px-3 py-2 font-semibold">Προμηθευτής (SoftOne)</th>
                  <th className="px-3 py-2 font-semibold">Τύπος</th>
                  <th className="px-3 py-2 text-right font-semibold">Σύνολο</th>
                  <th className="px-3 py-2 font-semibold">Καταχώριση</th>
                </tr>
              </thead>
              <tbody>
                {RESULTS.map((r) => (
                  <tr key={r.num} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-[12px] text-white/70">{r.num}</td>
                    <td className="px-3 py-2">
                      {r.supplier} <span className="font-mono text-[11px] text-white/40">#{r.code}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={r.type === 'service'
                          ? { background: 'rgba(194,65,12,.18)', color: '#fdba74' }
                          : { background: 'rgba(4,120,87,.18)', color: '#6ee7b7' }}>
                        {r.type === 'service' ? <FiTool className="h-3 w-3" /> : <FiBox className="h-3 w-3" />}
                        {r.type === 'service' ? 'Υπηρεσιών' : 'Προϊόντων'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                    <td className="px-3 py-2">
                      {r.posted
                        ? <span className="inline-flex items-center gap-1 text-emerald-300"><FiCheckCircle className="h-3.5 w-3.5" /> SoftOne</span>
                        : <span className="inline-flex items-center gap-1 text-amber-300"><FiClock className="h-3.5 w-3.5" /> Σε ουρά</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Value + pricing */}
        <section className="grid gap-4 md:grid-cols-3">
          {[
            { name: 'Starter', price: '€50', feat: ['1 εταιρία', '300 παραστατικά/μήνα', 'OCR + email'], accent: '#60A5FA' },
            { name: 'Pro', price: '€150', feat: ['Έως 3 εταιρίες', '1.500 παραστατικά', 'Auto-post SoftOne'], accent: '#34D399', hot: true },
            { name: 'Λογιστικό Γραφείο', price: '€600+', feat: ['Απεριόριστες εταιρίες', 'Priority + SLA', 'Bulk auto-post'], accent: '#E31E2A' },
          ].map((p) => (
            <div key={p.name} className={`rounded-2xl border p-5 ${p.hot ? 'border-[#34D399]/40 bg-[#34D399]/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">{p.name}</h3>
                {p.hot && <span className="rounded-full bg-[#34D399]/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">ΔΗΜΟΦΙΛΕΣ</span>}
              </div>
              <p className="mt-1 text-2xl font-bold" style={{ color: p.accent }}>{p.price}<span className="text-[12px] font-normal text-white/40">/μήνα</span></p>
              <ul className="mt-3 space-y-1.5 text-[12px] text-white/60">
                {p.feat.map((f) => <li key={f} className="flex items-center gap-2"><FiCheckCircle className="h-3.5 w-3.5 text-emerald-400/70" /> {f}</li>)}
              </ul>
            </div>
          ))}
        </section>

        <footer className="flex flex-wrap items-center justify-center gap-4 pb-4 pt-2 text-[11px] text-white/30">
          <span className="inline-flex items-center gap-1"><FiShield className="h-3 w-3" /> Κρυπτογραφημένα credentials</span>
          <span className="inline-flex items-center gap-1"><FiTrendingUp className="h-3 w-3" /> ~€0,02/σελίδα κόστος</span>
          <span className="inline-flex items-center gap-1"><FiTruck className="h-3 w-3" /> Reconcile exactly-once</span>
          <span>· Demo περιβάλλον — εικονικά δεδομένα</span>
        </footer>
      </main>
    </div>
  );
}

function Kpi({ icon, value, label, accent = '#FFFFFF' }: { icon: React.ReactNode; value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/10" style={{ color: accent }}>{icon}</div>
      <p className="text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
      <p className="text-[11px] text-white/45">{label}</p>
    </div>
  );
}
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><span className="text-white/60">{icon}</span> {title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-white/45">{label}</span>
      <span className="text-white/80">{value}</span>
    </div>
  );
}
