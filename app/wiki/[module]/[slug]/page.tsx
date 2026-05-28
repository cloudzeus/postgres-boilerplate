import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft, FiArrowRight, FiClock, FiChevronRight } from 'react-icons/fi';
import { requireUser } from '@/lib/rbac';
import { loadPage, loadAllPages, getModulesTree } from '@/lib/wiki/loader';
import { canAccessWikiPage, filterPagesForRole } from '@/lib/wiki/access';
import { compileMdxToHtml } from '@/lib/wiki/compile';
import { Screenshot } from '@/components/wiki/mdx-components';
import { type WikiRoleKey } from '@/lib/wiki/types';
import { getModuleMeta, gradientStyle } from '@/lib/wiki/modules-meta';

export default async function WikiPage({ params }: { params: Promise<{ module: string; slug: string }> }) {
  const { module, slug } = await params;
  const user = await requireUser();
  const roleKey = (user.role.key as WikiRoleKey | null) ?? null;

  const page = loadPage(module, slug);
  if (!page) notFound();
  if (!canAccessWikiPage(roleKey, page.frontmatter.roles)) notFound();

  const html = await compileMdxToHtml(page.content, module, slug);
  const meta = getModuleMeta(module);
  const Icon = meta.icon;

  // Prev / next within module
  const moduleNode = getModulesTree().find((m) => m.module === module);
  const siblings = moduleNode ? filterPagesForRole(moduleNode.pages, roleKey) : [];
  const idx = siblings.findIndex((p) => p.frontmatter.slug === slug);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const related = page.frontmatter.related
    .map((slugRef) => loadAllPages().find((p) => p.frontmatter.slug === slugRef))
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && canAccessWikiPage(roleKey, p!.frontmatter.roles));

  return (
    <article>
      <nav className="mb-4 flex items-center gap-1 text-[12px] text-muted-foreground">
        <Link href="/wiki" className="hover:text-foreground">Οδηγός</Link>
        <FiChevronRight className="size-3" />
        <Link href={`/wiki/${module}`} className="hover:text-foreground">{meta.label}</Link>
        <FiChevronRight className="size-3" />
        <span className="text-foreground truncate">{page.frontmatter.title}</span>
      </nav>

      <header className="relative overflow-hidden rounded-2xl p-6 text-white shadow-md lg:p-7" style={gradientStyle(meta)}>
        <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/25 backdrop-blur">
            <Icon className="size-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-white/80">{meta.label}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white lg:text-[28px]">{page.frontmatter.title}</h1>
            {page.frontmatter.description && (
              <p className="mt-2 text-[14px] text-white/90">{page.frontmatter.description}</p>
            )}
          </div>
        </div>
      </header>

      <div
        className="wiki-content prose prose-base mt-8 max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-[20px] prose-h2:font-bold prose-h3:mt-7 prose-h3:text-[16px] prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-foreground prose-a:text-sisyphus-600 prose-a:no-underline hover:prose-a:underline"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {page.frontmatter.screenshots.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-[18px] font-bold tracking-tight">📸 Στιγμιότυπα</h2>
          <div className="grid grid-cols-1 gap-4">
            {page.frontmatter.screenshots.map((s) => (
              <Screenshot key={s.file} src={s.file} caption={s.caption} module={module} page={slug} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-10 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-wide text-muted-foreground">Σχετικά άρθρα</h2>
          <ul className="space-y-2">
            {related.map((r) => {
              const rm = getModuleMeta(r.frontmatter.module);
              const RI = rm.icon;
              return (
                <li key={r.frontmatter.slug}>
                  <Link
                    href={`/wiki/${r.frontmatter.module}/${r.frontmatter.slug}`}
                    className="group flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-border hover:bg-muted/30"
                  >
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md"
                      style={{ background: rm.accentSoft, color: rm.accent }}
                    >
                      <RI className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">{r.frontmatter.title}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{rm.label}</span>
                    </span>
                    <FiArrowRight className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="mt-10 grid grid-cols-1 gap-3 border-t border-border pt-6 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/wiki/${module}/${prev.frontmatter.slug}`}
            className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition hover:shadow-sm"
          >
            <FiArrowLeft className="mt-1 size-4 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Προηγούμενο</p>
              <p className="mt-0.5 truncate text-[13.5px] font-medium">{prev.frontmatter.title}</p>
            </div>
          </Link>
        ) : <span />}
        {next ? (
          <Link
            href={`/wiki/${module}/${next.frontmatter.slug}`}
            className="group flex items-start justify-end gap-3 rounded-xl border border-border bg-card p-4 text-right transition hover:shadow-sm sm:col-start-2"
          >
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Επόμενο</p>
              <p className="mt-0.5 truncate text-[13.5px] font-medium">{next.frontmatter.title}</p>
            </div>
            <FiArrowRight className="mt-1 size-4 text-muted-foreground" />
          </Link>
        ) : null}
      </nav>

      {page.frontmatter.updatedAt && (
        <p className="mt-6 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <FiClock className="size-3" /> Τελευταία ενημέρωση: {page.frontmatter.updatedAt}
        </p>
      )}
    </article>
  );
}
