'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FiGrid, FiUsers, FiShield, FiKey, FiImage, FiChevronDown, FiList,
  FiActivity, FiSettings, FiFileText, FiLogOut, FiDatabase, FiBriefcase, FiLayers, FiCpu, FiBookOpen, FiUserCheck, FiBox, FiTool, FiFolder, FiAlertCircle, FiUserPlus, FiPackage, FiPlayCircle,
} from 'react-icons/fi';

type IconType = React.ComponentType<{ className?: string }>;

type NavItem = {
  href: string;
  label: string;
  icon: IconType;
  exact?: boolean;
  permissions?: string[];
  /** When set, only users with this role.key can see this item. */
  requireRoleKey?: string;
  badgeKey?: keyof Badges;
};
type NavGroup = { label: string; items: NavItem[] };

export interface Badges {
  pendingUsers?: number;
  /** Εκκρεμείς εκδότες χωρίς συναλλασσόμενο — από /api/admin/ocr/queues/counts. */
  newTraders?: number;
  /** Ομάδες γραμμών χωρίς αντιστοίχιση — από το ίδιο endpoint. */
  newItems?: number;
  /** Εργασίες σάρωσης που τρέχουν ή περιμένουν — από /api/admin/ocr/templates/jobs?count=1. */
  activeJobs?: number;
}

/** DGsoft wordmark shown at the top of the sidebar. */
const BRAND_LOGO_URL = 'https://espa-stamos.b-cdn.net/media/2026/05/dgplain-9bb7skuy.webp';
const OPEN_GROUPS_KEY = 'admin-sidebar-open-groups';

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Επισκόπηση',
    items: [
      { href: '/admin', label: 'Dashboard', icon: FiGrid, exact: true },
    ],
  },
  {
    label: 'Δεδομένα',
    items: [
      { href: '/admin/traders', label: 'Συναλλασσόμενοι', icon: FiUserCheck, permissions: ['metadata.read'] },
      { href: '/admin/items', label: 'Είδη', icon: FiBox, permissions: ['metadata.read'] },
      { href: '/admin/services', label: 'Υπηρεσίες', icon: FiTool, permissions: ['metadata.read'] },
      { href: '/admin/doc-series', label: 'Σειρές παραστατικών', icon: FiList, permissions: ['metadata.read'] },
      { href: '/admin/reference-data', label: 'Μητρώα αναφοράς', icon: FiLayers, permissions: ['metadata.read'] },
      { href: '/admin/document-types', label: 'Τύποι Δικαιολογητικών', icon: FiFileText, permissions: ['metadata.read'] },
      { href: '/admin/business-types', label: 'Νομικές Μορφές', icon: FiBriefcase, permissions: ['metadata.read'] },
      { href: '/admin/media', label: 'Media', icon: FiImage },
      { href: '/admin/ocr', label: 'OCR / Έγγραφα', icon: FiCpu, permissions: ['ocr.read'], exact: true },
      { href: '/admin/ocr/batches', label: 'Φάκελοι OCR', icon: FiFolder, permissions: ['ocr.read'] },
      { href: '/admin/ocr/new-traders', label: 'Νέοι συναλλασσόμενοι', icon: FiUserPlus, permissions: ['ocr.read'], badgeKey: 'newTraders' },
      { href: '/admin/ocr/new-items', label: 'Είδη & έξοδα', icon: FiPackage, permissions: ['ocr.read'], badgeKey: 'newItems' },
      { href: '/admin/ocr/pending', label: 'Εκκρεμότητες OCR', icon: FiAlertCircle, permissions: ['ocr.read'] },
      { href: '/admin/ocr/templates', label: 'Πρότυπα εξαγωγής', icon: FiLayers, permissions: ['ocr.read'], exact: true },
      { href: '/admin/ocr/templates/jobs', label: 'Εργασίες σάρωσης', icon: FiPlayCircle, permissions: ['ocr.read'], badgeKey: 'activeJobs' },
    ],
  },
  {
    label: 'Σύστημα',
    items: [
      { href: '/admin/audit', label: 'Audit log', icon: FiActivity, permissions: ['system.audit'] },
      { href: '/admin/backups', label: 'Backups', icon: FiDatabase, permissions: ['system.backups'] },
      { href: '/admin/settings', label: 'Ρυθμίσεις', icon: FiSettings, permissions: ['system.settings'] },
      { href: '/admin/ai-usage', label: 'AI Usage', icon: FiCpu, requireRoleKey: 'SUPER_ADMIN' },
      { href: '/admin/docs', label: 'API Docs', icon: FiFileText },
    ],
  },
  {
    label: 'Access control',
    items: [
      { href: '/admin/users', label: 'Χρήστες', icon: FiUsers, permissions: ['users.read'], badgeKey: 'pendingUsers' },
      { href: '/admin/roles', label: 'Ρόλοι', icon: FiShield, permissions: ['roles.read'] },
      { href: '/admin/permissions', label: 'Δικαιώματα', icon: FiKey, permissions: ['permissions.read'] },
    ],
  },
  {
    label: 'Βοήθεια',
    items: [
      { href: '/wiki', label: 'Οδηγός Χρήστη', icon: FiBookOpen },
    ],
  },
];

import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import type { LocaleCode } from '@/i18n/locales';

interface Props {
  user: { name?: string | null; email?: string | null };
  roleName: string;
  roleKey?: string | null;
  locale: LocaleCode;
  permissionKeys: string[];
  badges?: Badges;
}

function cn(...c: (string | false | undefined)[]) { return c.filter(Boolean).join(' '); }

export function AdminSidebar({ user, roleName, roleKey, locale, permissionKeys, badges = {} }: Props) {
  const path = usePathname();
  const initials = (user.name ?? user.email ?? '??')
    .split(/[\s@]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const allowed = (perms?: string[]) => !perms || perms.length === 0 || perms.some((p) => permissionKeys.includes(p));
  const allowedItem = (it: NavItem) => allowed(it.permissions) && (!it.requireRoleKey || it.requireRoleKey === roleKey);
  const isActive = (item: NavItem) => item.exact ? path === item.href : (path === item.href || path.startsWith(`${item.href}/`));

  // Collapsible groups: all open by default, remembered per browser, and the
  // group holding the current route is always forced open on navigation.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  /**
   * ΣΥΜΠΤΥΞΗ ΣΕ ΣΤΕΝΕΣ ΟΘΟΝΕΣ. Σε business laptop 1280px το sidebar των 244px είναι το **19%**
   * της οθόνης — και ο πίνακας παραστατικών, που θέλει ~1100px, αναγκαζόταν σε μόνιμη οριζόντια
   * κύλιση. Κάτω από 1440px ανοίγει συμπτυγμένο (μόνο εικονίδια, 60px) και κερδίζονται 184px.
   *
   * Ο χρήστης έχει πάντα τον τελευταίο λόγο: η επιλογή του αποθηκεύεται και ΝΙΚΑΕΙ το πλάτος —
   * ένα sidebar που ξαναμαζεύεται μόνο του σε κάθε φόρτωση είναι χειρότερο από στενή οθόνη.
   */
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem('admin.sidebar.collapsed'); } catch { /* private mode */ }
    if (saved === '1' || saved === '0') { setCollapsed(saved === '1'); return; }
    setCollapsed(window.innerWidth < 1440);
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem('admin.sidebar.collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '{}') as Record<string, boolean>;
      setOpen(saved);
    } catch { /* ignore */ }
  }, []);
  React.useEffect(() => {
    const current = NAV_GROUPS.find((g) => g.items.some(isActive));
    if (current && open[current.label] === false) {
      setOpen((o) => ({ ...o, [current.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const toggleGroup = (label: string) => {
    setOpen((o) => {
      const next = { ...o, [label]: o[label] === false };
      try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Queue badges («Νέοι συναλλασσόμενοι» / «Είδη & έξοδα») — fetched once on
  // mount. Any failure (404 while the route is not deployed, offline, 403) is
  // swallowed: the badge is decoration, never a blocker.
  const [queueCounts, setQueueCounts] = React.useState<Pick<Badges, 'newTraders' | 'newItems' | 'activeJobs'>>({});
  const canReadOcr = permissionKeys.includes('ocr.read');
  React.useEffect(() => {
    if (!canReadOcr) return;
    let cancelled = false;
    fetch('/api/admin/ocr/queues/counts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { traders?: unknown; items?: unknown } | null) => {
        if (cancelled || !d) return;
        setQueueCounts({ newTraders: Number(d.traders) || 0, newItems: Number(d.items) || 0 });
      })
      .catch(() => { /* badges are optional */ });
    // Οι ενεργές εργασίες σάρωσης είναι ξεχωριστό, φθηνό ερώτημα (ένα COUNT) — ζητείται και
    // περιοδικά, γιατί σε αντίθεση με τις ουρές αλλάζει μόνο του όσο ο χρήστης κοιτά αλλού.
    const jobs = () => fetch('/api/admin/ocr/templates/jobs?count=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { active?: unknown } | null) => { if (!cancelled && d) setQueueCounts((p) => ({ ...p, activeJobs: Number(d.active) || 0 })); })
      .catch(() => { /* badges are optional */ });
    void jobs();
    const timer = setInterval(() => { void jobs(); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [canReadOcr]);
  const allBadges: Badges = { ...badges, ...queueCounts };

  return (
    <aside
      data-collapsed={collapsed ? '' : undefined}
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar lg:flex cx-transition',
        collapsed ? 'w-[60px]' : 'w-[244px]',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <Link href="/admin" className="-m-1.5 flex items-center rounded-md p-1.5" aria-label="DGsoft">
          <img src={BRAND_LOGO_URL} alt="DGsoft" className="h-7 w-auto" />
        </Link>
        {!collapsed && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[length:var(--fs-10)] font-medium uppercase tracking-wide text-muted-foreground">
            <FiShield className="size-3" /> Admin
          </span>
        )}
        <button
          type="button" onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Άνοιγμα πλαϊνού μενού' : 'Σύμπτυξη πλαϊνού μενού'}
          title={collapsed ? 'Άνοιγμα μενού' : 'Σύμπτυξη μενού'}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground cx-transition hover:bg-[var(--cx-hover)] hover:text-foreground',
            collapsed ? 'mx-auto' : 'ml-1',
          )}
        >
          <FiChevronDown aria-hidden className={cn('size-3.5', collapsed ? '-rotate-90' : 'rotate-90')} />
        </button>
      </div>

      <div className={cn('border-b border-sidebar-border px-4 py-2.5', collapsed && 'hidden')}>
        <p className="cx-eyebrow">Ρόλος</p>
        <p className="mt-0.5 truncate text-[length:var(--fs-13)] font-medium text-foreground">{roleName}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter(allowedItem);
          if (visible.length === 0) return null;
          const expanded = open[group.label] !== false;
          const groupId = `nav-group-${group.label.replace(/\s+/g, '-')}`;
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={expanded}
                aria-controls={groupId}
                className={cn(
                  'mb-1 flex h-7 w-full items-center gap-1 rounded-sm px-2 text-left cx-transition hover:bg-[var(--cx-hover)]',
                  // Μαζεμένο: ο τίτλος ομάδας φεύγει, αλλά η ομάδα ΔΕΝ κλείνει — αλλιώς τα
                  // εικονίδια θα κρύβονταν κι αυτά και το μενού θα ήταν άχρηστο.
                  collapsed && 'hidden',
                )}
              >
                <span className="cx-eyebrow flex-1">{group.label}</span>
                <FiChevronDown
                  aria-hidden
                  className={cn('size-3.5 text-muted-foreground/80 cx-transition', expanded ? 'rotate-0' : '-rotate-90')}
                />
              </button>
              <ul id={groupId} className={cn('flex-col', expanded ? 'flex' : 'hidden')}>
                {visible.map((item) => {
                  const active = isActive(item);
                  const badge = item.badgeKey ? allBadges[item.badgeKey] : undefined;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        className={cn(
                          'group/item relative flex h-8 items-center rounded-sm text-[length:var(--fs-13)] font-medium cx-transition',
                          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
                          active
                            ? 'bg-[var(--cx-accent-soft)] text-foreground'
                            : 'text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-foreground',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--cx-accent)] cx-transition',
                            active ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <item.icon className={cn('size-3.5', active ? 'text-[var(--cx-accent)]' : 'text-muted-foreground/80')} />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {badge !== undefined && badge > 0 && (
                          collapsed
                            // Μαζεμένο: ο αριθμός δεν χωράει, αλλά η ΕΙΔΟΠΟΙΗΣΗ δεν επιτρέπεται να
                            // χαθεί — μένει ως κουκκίδα, με το πλήθος στο tooltip.
                            ? (
                              <span
                                aria-hidden
                                title={`${item.label}: ${badge}`}
                                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--cx-accent)]"
                              />
                            )
                            : (
                              <span className="min-w-[18px] rounded-full px-1 text-center text-[length:var(--fs-10)] font-medium tabular-nums text-muted-foreground ring-1 ring-inset ring-border/70">
                                {badge > 99 ? '99+' : badge}
                              </span>
                            )
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2 space-y-2">
        {!collapsed && (
          <div className="px-1">
            <LocaleSwitcher currentLocale={locale} />
          </div>
        )}
        <div className={cn('flex items-center rounded-sm py-1.5', collapsed ? 'flex-col gap-1 px-0' : 'gap-2.5 px-2')}>
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[length:var(--fs-10)] font-medium text-foreground">
            {initials || 'U'}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--fs-12)] font-medium text-foreground">{user.name ?? user.email ?? 'User'}</p>
              <p className="truncate text-[length:var(--fs-10)] uppercase tracking-wide text-muted-foreground">{roleName.toLowerCase()}</p>
            </div>
          )}
          <Link
            href="/api/auth/signout"
            title="Αποσύνδεση"
            className="grid size-7 place-items-center rounded-sm text-muted-foreground cx-transition hover:bg-[var(--cx-hover)] hover:text-foreground"
          >
            <FiLogOut className="size-3.5" />
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ---------------- Mobile bottom navigation ----------------

const MOBILE_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: FiGrid, exact: true },
  { href: '/admin/users', label: 'Χρήστες', icon: FiUsers },
  { href: '/admin/roles', label: 'Ρόλοι', icon: FiShield },
  { href: '/admin/permissions', label: 'Δικαιώματα', icon: FiKey },
  { href: '/admin/settings', label: 'Ρυθμίσεις', icon: FiSettings },
];

export function AdminBottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 lg:hidden h-[calc(4rem+env(safe-area-inset-bottom))] pt-1 pb-[env(safe-area-inset-bottom)] border-t border-border bg-sidebar/95 backdrop-blur grid grid-cols-5">
      {MOBILE_NAV.map((item) => {
        const active = item.exact ? path === item.href : (path === item.href || path.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 px-1 text-[length:var(--fs-10)] font-medium cx-transition',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <item.icon className="size-4" />
            <span className="truncate w-full text-center">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
