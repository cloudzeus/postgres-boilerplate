import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createOtpToken } from '@/lib/otp';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = formData.get('name')?.toString().trim();
  const email = formData.get('email')?.toString().trim().toLowerCase();
  const password = formData.get('password')?.toString();

  if (!name || !email || !password) {
    return new Response(null, { status: 302, headers: { Location: '/auth/register?error=missing' } });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return new Response(null, { status: 302, headers: { Location: '/auth/register?error=exists' } });
  }

  const defaultRole = await prisma.role.findUnique({ where: { key: 'CUSTOMER' } });
  if (!defaultRole) {
    return new Response(null, { status: 302, headers: { Location: '/auth/register?error=role_missing' } });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      roleId: defaultRole.id,
    },
  });

  await createOtpToken(email, 'register', user.id);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/auth/verify-otp?email=${encodeURIComponent(email)}&mode=register`,
    },
  });
}
