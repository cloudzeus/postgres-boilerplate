'use client';

import * as React from 'react';
import { FiArrowLeft, FiCheckCircle, FiInbox, FiSearch } from 'react-icons/fi';
import { PageHeader } from '@/components/admin/page-header';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQueueKeys } from './use-queue-keys';

/** One pill in the filter row above the queue. */
export interface QueueFilter {
  key: string;
  label: string;
  /** Shown as a small counter inside the pill; omit to hide. */
  count?: number;
}

export interface QueueProgress {
  done: number;
  total: number;
}

export interface QueueLayoutProps<T> {
  /** PageHeader — same props as everywhere else in /admin. */
  title: string;
  description?: string;
  helpAnchor?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;

  /** Rows of the queue, already filtered/sorted by the page. */
  items: T[];
  getId: (item: T) => string;
  /** Inner content of a row — the `li role="option"` wrapper is supplied here. */
  renderItem: (item: T, state: { selected: boolean }) => React.ReactNode;
  selectedId: string | null;
  onSelect: (id: string) => void;

  filters?: QueueFilter[];
  filter?: string;
  onFilter?: (key: string) => void;

  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;

  /** «Ν από Μ» + progress bar in the list header. */
  progress?: QueueProgress;
  /** Rendered instead of the list when `items` is empty — use `QueueEmpty`. */
  empty?: React.ReactNode;

  /** Enter on the selected row. */
  onPrimary?: (id: string) => void;
  /** Escape. Defaults to clearing the search when a search value is present. */
  onEscape?: () => void;
  /** Turn the keyboard shortcuts off (e.g. while a dialog is open). */
  keysEnabled?: boolean;

  /** Accessible name of the listbox, e.g. «Ουρά εκδοτών». */
  listLabel?: string;
  /** Detail panel. */
  children?: React.ReactNode;
  panelClassName?: string;
  className?: string;
}

/** Stable, whitespace-free DOM id for a row so `aria-activedescendant` works. */
export function queueOptionId(id: string): string {
  return `queue-opt-${encodeURIComponent(id).replace(/%/g, '_')}`;
}

export interface QueueRowProps {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * The `li role="option"` wrapper with selection styling — pages only supply the
 * inner content. Exported for lists that do not go through `QueueLayout`.
 */
export function QueueRow({ id, selected, onSelect, children, className }: QueueRowProps) {
  return (
    <li
      id={queueOptionId(id)}
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={cn(
        'flex min-h-[56px] cursor-pointer items-center gap-3 border-b border-l-4 border-b-border/60 px-3 py-2',
        'cx-transition motion-reduce:transition-none',
        selected
          ? 'border-l-sisyphus-500 bg-sisyphus-50'
          : 'border-l-transparent hover:bg-[var(--cx-hover)]',
        selected &&
          'group-focus-visible/queue:ring-2 group-focus-visible/queue:ring-inset group-focus-visible/queue:ring-sisyphus-500',
        className,
      )}
    >
      {children}
    </li>
  );
}

export interface QueueEmptyProps {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

/** Empty state for a queue list or a detail panel: icon + title + hint. */
export function QueueEmpty({ icon, title, hint, action }: QueueEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-full bg-neutral-6 text-muted-foreground [&_svg]:size-5"
      >
        {icon ?? <FiInbox />}
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-[38ch] text-body-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Below `lg` the detail panel sits under the list instead of beside it. */
function isStacked(): boolean {
  return typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches;
}

/**
 * Master–detail queue shell: searchable/filterable list on the left, sticky
 * detail panel on the right, keyboard navigation (J/K/↑/↓/Enter/Esc). Purely
 * presentational — every piece of state is owned by the page.
 */
export function QueueLayout<T,>({
  title,
  description,
  helpAnchor,
  icon,
  actions,
  items,
  getId,
  renderItem,
  selectedId,
  onSelect,
  filters,
  filter,
  onFilter,
  search,
  onSearch,
  searchPlaceholder = 'Αναζήτηση…',
  progress,
  empty,
  onPrimary,
  onEscape,
  keysEnabled = true,
  listLabel = 'Ουρά εργασιών',
  children,
  panelClassName,
  className,
}: QueueLayoutProps<T>) {
  const listRef = React.useRef<HTMLElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);

  const ids = items.map(getId);

  // Selecting on a narrow screen brings the panel into view; «Πίσω στη λίστα»
  // goes back up. Both honour prefers-reduced-motion.
  const scrollTo = React.useCallback((el: HTMLElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }, []);

  const handleSelect = React.useCallback(
    (id: string) => {
      onSelect(id);
      if (isStacked()) scrollTo(panelRef.current);
    },
    [onSelect, scrollTo],
  );

  // Keep the keyboard-selected row visible inside the scrolling list.
  React.useEffect(() => {
    if (!selectedId || isStacked()) return;
    document.getElementById(queueOptionId(selectedId))?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const handleEscape = React.useCallback(() => {
    if (onEscape) { onEscape(); return; }
    if (search) onSearch('');
  }, [onEscape, onSearch, search]);

  useQueueKeys({ ids, selectedId, onSelect: handleSelect, onPrimary, onEscape: handleEscape, enabled: keysEnabled });

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <div className={cn('w-full', className)}>
      <PageHeader icon={icon} title={title} description={description} helpAnchor={helpAnchor} actions={actions} />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
        <section
          ref={listRef}
          aria-label={listLabel}
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2"
        >
          {/* Sticky toolbar: search, filter pills, session progress. */}
          <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-neutral-4 px-3 py-2.5">
            <div className="relative">
              <FiSearch
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    onSearch('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-11 bg-neutral-0 pl-8 lg:h-8"
              />
            </div>

            {filters && filters.length > 0 && (
              <div role="tablist" aria-label="Φίλτρα" className="flex flex-wrap gap-1.5">
                {filters.map((f) => {
                  const active = f.key === filter;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onFilter?.(f.key)}
                      className={cn(
                        'inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium lg:h-7',
                        'cx-transition motion-reduce:transition-none',
                        'outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500 focus-visible:ring-offset-1',
                        active
                          ? 'border-sisyphus-500 bg-sisyphus-50 text-sisyphus-700'
                          : 'border-border bg-neutral-0 text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-foreground',
                      )}
                    >
                      {f.label}
                      {typeof f.count === 'number' && (
                        <span
                          className={cn(
                            'rounded-full px-1 text-[10px] tabular-nums',
                            active ? 'bg-sisyphus-100 text-sisyphus-700' : 'bg-neutral-8 text-muted-foreground',
                          )}
                        >
                          {f.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {progress && (
              <div>
                <div className="flex items-center justify-between text-caption text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FiCheckCircle aria-hidden className="size-3.5 text-success-500" />
                    {progress.done} από {progress.total}
                  </span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Πρόοδος συνεδρίας"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-8"
                >
                  <div
                    className="h-full rounded-full bg-sisyphus-500 cx-transition motion-reduce:transition-none"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            empty ?? (
              <QueueEmpty
                title="Καμία εγγραφή"
                hint="Δοκίμασε άλλο φίλτρο ή καθάρισε την αναζήτηση."
              />
            )
          ) : (
            <ul
              role="listbox"
              tabIndex={0}
              aria-label={listLabel}
              aria-activedescendant={selectedId ? queueOptionId(selectedId) : undefined}
              className="group/queue max-h-[calc(100dvh-14rem)] flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sisyphus-500"
            >
              {items.map((item) => {
                const id = getId(item);
                const selected = id === selectedId;
                return (
                  <QueueRow key={id} id={id} selected={selected} onSelect={handleSelect}>
                    {renderItem(item, { selected })}
                  </QueueRow>
                );
              })}
            </ul>
          )}

          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-border bg-neutral-4 px-3 py-1.5 text-caption text-muted-foreground">
            <span>
              <kbd className="rounded-sm border border-border bg-neutral-0 px-1 font-sans">J</kbd>
              {' / '}
              <kbd className="rounded-sm border border-border bg-neutral-0 px-1 font-sans">K</kbd> επόμενο
            </span>
            <span aria-hidden>·</span>
            <span>
              <kbd className="rounded-sm border border-border bg-neutral-0 px-1 font-sans">Enter</kbd> επιβεβαίωση
            </span>
          </p>
        </section>

        <aside ref={panelRef} className="min-w-0 lg:sticky lg:top-4">
          <button
            type="button"
            onClick={() => scrollTo(listRef.current)}
            className="mb-2 inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-sisyphus-700 outline-none cx-transition motion-reduce:transition-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 lg:hidden"
          >
            <FiArrowLeft aria-hidden className="size-4" />
            Πίσω στη λίστα
          </button>
          <div className={cn('rounded-xl border border-border bg-card shadow-fluent-2', panelClassName)}>
            {children}
          </div>
        </aside>
      </div>
    </div>
  );
}
