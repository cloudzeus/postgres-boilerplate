import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createOtpToken } from '@/lib/otp';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = formData.get('email')?.toString().trim().toLowerCase();
  const mode = formData.get('mode')?.toString() as 'reset' | 'login';

  if (!email || !mode || !['reset', 'login'].includes(mode)) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=missing' } });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: `/auth/signin?error=notfound` } });
  }

  if (mode === 'login' && !user.emailVerified) {
    return new Response(null, { status: 302, headers: { Location: '/auth/signin?error=unverified' } });
  }

  await createOtpToken(email, mode, user.id);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/auth/verify-otp?email=${encodeURIComponent(email)}&mode=${mode}`,
    },
  });
}
