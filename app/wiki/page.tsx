import Link from 'next/link';
import { FiArrowRight, FiBookOpen } from 'react-icons/fi';
import { requireUser } from '@/lib/rbac';
import { getModulesTree } from '@/lib/wiki/loader';
import { filterPagesForRole } from '@/lib/wiki/access';
import type { WikiRoleKey } from '@/lib/wiki/types';
import { getModuleMeta, gradientStyle } from '@/lib/wiki/modules-meta';

export default async function WikiIndexPage() {
  const user = await requireUser();
  const roleKey = (user.role.key as WikiRoleKey | null) ?? null;

  const modules = getModulesTree()
    .map((m) => ({ ...m, pages: filterPagesForRole(m.pages, roleKey) }))
    .filter((m) => m.pages.length > 0);

  const totalPages = modules.reduce((acc, m) => acc + m.pages.length, 0);
  const firstName = (user.name ?? user.email ?? '').split(' ')[0] || '';

  return (
    <div>
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl px-6 py-10 text-white shadow-lg lg:px-10 lg:py-14"
        style={{ backgroundImage: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 50%, #7c3aed 100%)' }}
      >
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 size-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-[11px] font-medium uppercase tracking-wide backdrop-blur">
            <FiBookOpen className="size-3.5" />
            Οδηγός Χρήστη
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white lg:text-4xl">
            Γεια σου{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-white/90 lg:text-base">
            Εδώ θα βρεις βήμα-βήμα οδηγίες για όλες τις λειτουργίες της εφαρμογής.
            Διάλεξε μια κατηγορία παρακάτω ή χρησιμοποίησε την αναζήτηση αριστερά.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-[13px] text-white/85">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 backdrop-blur">
              <span className="size-1.5 rounded-full bg-white" />
              {user.role.name}
            </span>
            <span>{totalPages} σελίδες οδηγού διαθέσιμες για εσένα</span>
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tip icon="🔍" title="Αναζήτηση" text="Πάτα στο πεδίο αναζήτησης πάνω αριστερά για γρήγορη εύρεση." />
        <Tip icon="❓" title="Βοήθεια ανά σελίδα" text='Σε κάθε σελίδα της εφαρμογής υπάρχει εικονίδιο "?" πάνω δεξιά.' />
        <Tip icon="🎯" title="Προσαρμοσμένο για σένα" text="Βλέπεις μόνο τα τμήματα που αφορούν τον ρόλο σου." />
      </div>

      <h2 className="mt-10 mb-4 text-[18px] font-semibold tracking-tight text-foreground">Κατηγορίες οδηγού</h2>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          Δεν υπάρχουν ακόμη σελίδες οδηγού για τον ρόλο σου.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const meta = getModuleMeta(m.module);
            const Icon = meta.icon;
            const firstPage = m.pages[0];
            return (
              <Link
                key={m.module}
                href={`/wiki/${m.module}/${firstPage.frontmatter.slug}`}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderTop: `4px solid ${meta.accent}` }}
              >
                <div
                  className="inline-flex size-11 items-center justify-center rounded-lg"
                  style={{ background: meta.accentSoft, color: meta.accent }}
                >
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-foreground">{meta.label || m.title}</h3>
                <p className="mt-1 text-[12.5px] text-muted-foreground line-clamp-2">{meta.description}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {m.pages.length} {m.pages.length === 1 ? 'σελίδα' : 'σελίδες'}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-[12px] font-semibold opacity-0 transition group-hover:opacity-100"
                    style={{ color: meta.accent }}
                  >
                    Άνοιγμα <FiArrowRight className="size-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tip({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <span aria-hidden className="text-xl leading-none">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
