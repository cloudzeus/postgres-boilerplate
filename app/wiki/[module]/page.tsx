import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowRight, FiClock } from 'react-icons/fi';
import { requireUser } from '@/lib/rbac';
import { getModulesTree } from '@/lib/wiki/loader';
import { filterPagesForRole } from '@/lib/wiki/access';
import { type WikiRoleKey } from '@/lib/wiki/types';
import { getModuleMeta, gradientStyle } from '@/lib/wiki/modules-meta';

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const user = await requireUser();
  const roleKey = (user.role.key as WikiRoleKey | null) ?? null;

  const m = getModulesTree().find((x) => x.module === module);
  if (!m) notFound();
  const pages = filterPagesForRole(m.pages, roleKey);
  if (pages.length === 0) notFound();

  const meta = getModuleMeta(module);
  const Icon = meta.icon;

  return (
    <div>
      <nav className="mb-4 text-[12px] text-muted-foreground">
        <Link href="/wiki" className="hover:text-foreground">Οδηγός</Link>
        <span className="mx-1">/</span>
        <span className="text-foreground">{meta.label}</span>
      </nav>

      <header
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-md lg:p-8"
        style={gradientStyle(meta)}
      >
        <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/25 backdrop-blur">
            <Icon className="size-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white lg:text-3xl">{meta.label}</h1>
            <p className="mt-1 text-[14px] text-white/90">{meta.description}</p>
            <p className="mt-3 text-[12px] text-white/80">{pages.length} {pages.length === 1 ? 'άρθρο' : 'άρθρα'} σε αυτή την κατηγορία</p>
          </div>
        </div>
      </header>

      <ul className="mt-6 space-y-3">
        {pages.map((p, i) => (
          <li key={p.frontmatter.slug}>
            <Link
              href={`/wiki/${module}/${p.frontmatter.slug}`}
              className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[14px] font-semibold"
                style={{ background: meta.accentSoft, color: meta.accent }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{p.frontmatter.title}</h3>
                {p.frontmatter.description && (
                  <p className="mt-1 text-[13px] text-muted-foreground">{p.frontmatter.description}</p>
                )}
                {p.frontmatter.updatedAt && (
                  <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FiClock className="size-3" />
                    Ενημερώθηκε {p.frontmatter.updatedAt}
                  </p>
                )}
              </div>
              <FiArrowRight className="mt-2 size-4 shrink-0 opacity-0 transition group-hover:opacity-100" style={{ color: meta.accent }} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
