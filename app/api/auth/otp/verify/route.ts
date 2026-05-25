import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOtpToken } from '@/lib/otp';
import { createSessionToken, createAuthenticatedResponse } from '@/lib/session';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = formData.get('email')?.toString().trim().toLowerCase();
  const code = formData.get('code')?.toString().trim();
  const mode = formData.get('mode')?.toString() as 'register' | 'reset' | 'login';
  const password = formData.get('password')?.toString();

  if (!email || !code || !mode) {
    return new Response(null, { status: 302, headers: { Location: `/auth/verify-otp?email=${encodeURIComponent(email ?? '')}&mode=${mode ?? 'reset'}&error=missing` } });
  }

  const validOtp = await verifyOtpToken(email, code, mode);
  if (!validOtp) {
    return new Response(null, { status: 302, headers: { Location: `/auth/verify-otp?email=${encodeURIComponent(email)}&mode=${mode}&error=invalid` } });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=notfound' } });
  }

  if (mode === 'register') {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?success=verified' } });
  }

  if (mode === 'reset') {
    if (!password) {
      return new Response(null, { status: 302, headers: { Location: `/auth/verify-otp?email=${encodeURIComponent(email)}&mode=reset&error=missing_password` } });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerified: user.emailVerified ?? new Date() } });
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?success=reset' } });
  }

  if (mode === 'login') {
    const token = createSessionToken(user.id);
    const key = user.role.key;
    const redirectUrl = key === 'SUPER_ADMIN' || key === 'ADMIN'
      ? '/admin'
      : key ? `/dashboard/${key.toLowerCase()}` : '/admin';
    return createAuthenticatedResponse(redirectUrl, token);
  }

  return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=invalid' } });
}
