import { redirect } from 'next/navigation';
import { cache } from 'react';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

export type UserWithRole = Awaited<ReturnType<typeof getCurrentUserWithPermissions>>;

export const getCurrentUserWithPermissions = cache(async () => {
  const base = await getCurrentUser();
  if (!base) return null;
  const user = await prisma.user.findUnique({
    where: { id: base.id },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });
  if (!user) return null;
  const permissionKeys = new Set(user.role.permissions.map((rp) => rp.permission.key));
  return { ...user, permissionKeys };
});

export async function hasPermission(key: string): Promise<boolean> {
  const u = await getCurrentUserWithPermissions();
  if (!u) return false;
  if (u.role.key === 'SUPER_ADMIN') return true;
  return u.permissionKeys.has(key);
}

export async function requireUser() {
  const u = await getCurrentUserWithPermissions();
  if (!u) redirect('/auth/signin');
  return u;
}

export async function requirePermission(key: string) {
  const u = await requireUser();
  if (u.role.key === 'SUPER_ADMIN') return u;
  if (!u.permissionKeys.has(key)) redirect('/dashboard?error=forbidden');
  return u;
}

export async function requireAnyPermission(...keys: string[]) {
  const u = await requireUser();
  if (u.role.key === 'SUPER_ADMIN') return u;
  if (!keys.some((k) => u.permissionKeys.has(k))) redirect('/dashboard?error=forbidden');
  return u;
}
