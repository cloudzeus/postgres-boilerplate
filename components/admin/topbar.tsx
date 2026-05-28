'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FiSearch, FiBell, FiLogOut, FiUser, FiHelpCircle } from 'react-icons/fi';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = { user: { name: string | null; email: string; image: string | null }; roleName: string };

function Breadcrumb() {
  const path = usePathname();
  const segs = path.split('/').filter(Boolean);
  return (
    <nav className="hidden md:flex items-center gap-1 text-body-sm text-neutral-50 truncate">
      {segs.map((seg, i) => {
        const href = '/' + segs.slice(0, i + 1).join('/');
        const last = i === segs.length - 1;
        return (
          <React.Fragment key={href}>
            {i > 0 && <span className="text-neutral-30">/</span>}
            {last ? (
              <span className="text-neutral-90 font-medium capitalize">{decodeURIComponent(seg)}</span>
            ) : (
              <Link href={href} className="hover:text-sisyphus-500 capitalize">{decodeURIComponent(seg)}</Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function AdminTopbar({ user, roleName }: Props) {
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 h-12 bg-acrylic backdrop-blur-md border-b border-neutral-10 flex items-center gap-3 px-3 lg:px-4">
      <div className="lg:hidden w-8" />
      <div className="flex-1 min-w-0"><Breadcrumb /></div>

      <div className="relative w-full md:w-64 max-w-xs">
        <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-40" />
        <input
          type="text"
          placeholder="Αναζήτηση..."
          className="w-full h-7 pl-8 pr-3 text-body-sm rounded-sm border border-neutral-20 bg-white hover:border-neutral-40 focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-100 transition-colors"
        />
      </div>

      <Link
        href="/wiki"
        title="Οδηγός Χρήστη"
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-neutral-60 hover:bg-neutral-10 transition-colors"
        aria-label="Οδηγός Χρήστη"
      >
        <FiHelpCircle className="h-4 w-4" />
      </Link>
      <button
        type="button"
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-sm text-neutral-60 hover:bg-neutral-10 transition-colors"
        aria-label="Notifications"
      >
        <FiBell className="h-4 w-4" />
        <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-dg-red-500" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 h-7 pl-1 pr-2 rounded-sm hover:bg-neutral-10 transition-colors">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sisyphus-500 text-white text-caption font-semibold">
            {initials}
          </span>
          <span className="hidden md:block text-body-sm font-medium text-neutral-90 truncate max-w-[140px]">
            {user.name ?? user.email}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>
            <div className="text-body font-medium text-neutral-90 truncate normal-case tracking-normal">
              {user.name ?? user.email}
            </div>
            <div className="text-caption text-neutral-50 truncate normal-case tracking-normal mt-0.5">{user.email}</div>
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-xs bg-sisyphus-50 text-sisyphus-700 px-1.5 py-0.5 text-caption font-medium uppercase tracking-wide">
              {roleName}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/admin/profile"><FiUser /> Προφίλ</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/wiki"><FiHelpCircle /> Οδηγός Χρήστη</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" asChild><Link href="/api/auth/signout"><FiLogOut /> Αποσύνδεση</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
