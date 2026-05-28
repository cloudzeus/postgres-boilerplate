import type { WikiRoleKey } from './types';

export function canAccessWikiPage(userRole: WikiRoleKey | null | undefined, pageRoles: WikiRoleKey[]): boolean {
  if (!userRole) return false;
  if (userRole === 'SUPER_ADMIN') return true;
  return pageRoles.includes(userRole);
}

export function filterPagesForRole<T extends { frontmatter: { roles: WikiRoleKey[] } }>(
  pages: T[],
  userRole: WikiRoleKey | null | undefined,
): T[] {
  return pages.filter((p) => canAccessWikiPage(userRole, p.frontmatter.roles));
}
