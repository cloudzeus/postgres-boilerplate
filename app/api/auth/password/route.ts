import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createSessionToken, createAuthenticatedResponse } from '@/lib/session';
import { logAudit } from '@/lib/audit';

const routesByRoleKey: Record<string, string> = {
  SUPER_ADMIN: '/admin',
  ADMIN: '/admin',
  EMPLOYEE: '/dashboard/employee',
  COLLABORATOR: '/dashboard/collaborator',
  SUPPLIER: '/dashboard/supplier',
  CUSTOMER: '/dashboard/customer',
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = formData.get('email')?.toString().trim().toLowerCase();
  const password = formData.get('password')?.toString();

  if (!email || !password) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=missing' } });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user || !user.passwordHash) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=invalid' } });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword || !user.emailVerified || !user.isActive) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=invalid' } });
  }

  const token = createSessionToken(user.id);
  await logAudit({
    userId: user.id, userEmail: user.email,
    action: 'auth.login', resource: 'session',
    metadata: { method: 'password' },
  });
  const redirectUrl = user.role.key ? (routesByRoleKey[user.role.key] ?? '/dashboard/customer') : '/admin';
  return createAuthenticatedResponse(redirectUrl, token);
}
