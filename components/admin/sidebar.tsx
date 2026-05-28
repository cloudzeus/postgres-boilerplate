'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FiGrid, FiUsers, FiShield, FiKey, FiUpload, FiImage,
  FiActivity, FiSettings, FiFileText, FiLogOut, FiDatabase, FiBriefcase, FiTag, FiLayers, FiCpu, FiGlobe, FiBookOpen,
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
  newImports?: number;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Επισκόπηση',
    items: [
      { href: '/admin', label: 'Dashboard', icon: FiGrid, exact: true },
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
    label: 'Δεδομένα',
    items: [
      { href: '/admin/companies', label: 'Εταιρίες', icon: FiBriefcase, permissions: ['companies.read'] },
      { href: '/admin/kad-codes', label: 'Μητρώο ΚΑΔ', icon: FiTag, permissions: ['kad.read'] },
      { href: '/admin/reference-data', label: 'Μητρώα αναφοράς', icon: FiLayers, permissions: ['metadata.read'] },
      { href: '/admin/imports', label: 'Excel Imports', icon: FiUpload, permissions: ['imports.read'], badgeKey: 'newImports' },
      { href: '/admin/media', label: 'Media', icon: FiImage },
      { href: '/admin/ocr', label: 'OCR / Έγγραφα', icon: FiCpu, permissions: ['ocr.read'] },
      { href: '/admin/programs', label: 'Ευρωπαϊκά Προγράμματα', icon: FiGlobe, permissions: ['programs.read'] },
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

  return (
    <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <Link href="/admin" className="-m-1.5 rounded-md p-1.5 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-dg-red-500 text-white text-[11px] font-bold">DG</span>
          <span className="text-[14px] font-semibold tracking-tight">DGEspa</span>
        </Link>
        <span className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <FiShield className="size-3" /> Admin
        </span>
      </div>

      <div className="border-b border-sidebar-border px-4 py-2.5">
        <p className="cx-eyebrow">Ρόλος</p>
        <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{roleName}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter(allowedItem);
          if (visible.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="cx-eyebrow mb-1 px-2">{group.label}</p>
              <ul className="flex flex-col">
                {visible.map((item) => {
                  const active = item.exact ? path === item.href : (path === item.href || path.startsWith(`${item.href}/`));
                  const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'group/item relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-[13px] font-medium cx-transition',
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
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge !== undefined && badge > 0 && (
                          <span className="min-w-[18px] rounded-full px-1 text-center text-[10px] font-medium tabular-nums text-muted-foreground ring-1 ring-inset ring-border/70">
                            {badge > 99 ? '99+' : badge}
                          </span>
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
        <div className="px-1">
          <LocaleSwitcher currentLocale={locale} />
        </div>
        <div className="flex items-center gap-2.5 rounded-sm px-2 py-1.5">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium text-foreground">
            {initials || 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-foreground">{user.name ?? user.email ?? 'User'}</p>
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{roleName.toLowerCase()}</p>
          </div>
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
              'flex flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium cx-transition',
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
