'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FiSearch, FiChevronDown } from 'react-icons/fi';
import type { WikiModule } from '@/lib/wiki/types';
import { getModuleMeta } from '@/lib/wiki/modules-meta';

function cn(...c: (string | false | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function WikiSidebar({ modules }: { modules: WikiModule[] }) {
  const path = usePathname();
  const [q, setQ] = React.useState('');
  const [openMods, setOpenMods] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    modules.forEach((m) => {
      if (path.startsWith(`/wiki/${m.module}`)) s.add(m.module);
    });
    return s;
  });

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return modules;
    return modules
      .map((m) => ({
        ...m,
        pages: m.pages.filter(
          (p) =>
            p.frontmatter.title.toLowerCase().includes(term) ||
            (p.frontmatter.description ?? '').toLowerCase().includes(term),
        ),
      }))
      .filter((m) => m.pages.length > 0);
  }, [q, modules]);

  const isSearching = q.trim().length > 0;

  return (
    <>
      <div className="border-b border-sidebar-border p-3">
        <div className="relative">
          <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Αναζήτηση στον οδηγό…"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-2 py-2 text-[12.5px] outline-none transition focus:border-sisyphus-500 focus:ring-2 focus:ring-sisyphus-100"
          />
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
        {filtered.length === 0 && (
          <p className="px-2 text-[12px] text-muted-foreground">Δεν βρέθηκαν σελίδες.</p>
        )}
        {filtered.map((m) => {
          const meta = getModuleMeta(m.module);
          const Icon = meta.icon;
          const isOpen = isSearching || openMods.has(m.module);
          const inModule = path.startsWith(`/wiki/${m.module}`);
          return (
            <div key={m.module}>
              <button
                type="button"
                onClick={() => {
                  setOpenMods((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.module)) next.delete(m.module);
                    else next.add(m.module);
                    return next;
                  });
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold transition text-foreground hover:bg-[var(--cx-hover)]',
                  inModule && 'bg-[var(--cx-accent-soft)]',
                )}
              >
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
                  style={{ background: meta.accentSoft, color: meta.accent }}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="flex-1 truncate">{meta.label || m.title}</span>
                <FiChevronDown className={cn('size-3 text-muted-foreground transition', isOpen ? 'rotate-0' : '-rotate-90')} />
              </button>
              {isOpen && (
                <ul className="mt-0.5 ml-8 flex flex-col border-l border-border pl-2">
                  {m.pages.map((p) => {
                    const href = `/wiki/${p.frontmatter.module}/${p.frontmatter.slug}`;
                    const active = path === href;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className={cn(
                            'relative flex items-center rounded-md px-2 py-1 text-[12px] cx-transition',
                            active
                              ? 'font-medium text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {active && (
                            <span
                              aria-hidden
                              className="absolute -left-[10px] top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full"
                              style={{ background: meta.accent }}
                            />
                          )}
                          <span className="truncate">{p.frontmatter.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}
