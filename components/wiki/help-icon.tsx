import * as React from 'react';
import Link from 'next/link';
import { FiHelpCircle } from 'react-icons/fi';
import { findHelpAnchor } from '@/lib/wiki/loader';
import { getCurrentUserWithPermissions } from '@/lib/rbac';
import { canAccessWikiPage } from '@/lib/wiki/access';
import type { WikiRoleKey } from '@/lib/wiki/types';

interface Props {
  anchor: string;
  className?: string;
}

export async function HelpIcon({ anchor, className }: Props) {
  const page = findHelpAnchor(anchor);
  if (!page) return null;
  const user = await getCurrentUserWithPermissions();
  const roleKey = (user?.role.key as WikiRoleKey | undefined) ?? null;
  if (!canAccessWikiPage(roleKey, page.frontmatter.roles)) return null;

  const href = `/wiki/${page.frontmatter.module}/${page.frontmatter.slug}`;
  return (
    <Link
      href={href}
      target="_blank"
      title={`Βοήθεια: ${page.frontmatter.title}`}
      aria-label={`Βοήθεια: ${page.frontmatter.title}`}
      className={`inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-[var(--cx-hover)] hover:text-foreground ${className ?? ''}`}
    >
      <FiHelpCircle className="size-4" />
    </Link>
  );
}
