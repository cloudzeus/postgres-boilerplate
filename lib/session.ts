import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';

const COOKIE_NAME = 'erp_session';
const SECRET = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || 'dev-session-secret';
const MAX_AGE = 60 * 60 * 24 * 30;

export function createSessionToken(userId: string) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '30d' });
}

export function verifySessionToken(token: string) {
  try {
    return jwt.verify(token, SECRET) as { sub: string };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload?.sub) return null;
  return prisma.user.findUnique({ where: { id: payload.sub } });
}

function buildCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function createAuthenticatedResponse(url: string, token: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': buildCookie(token, MAX_AGE),
    },
  });
}

export function clearSessionResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': buildCookie('', 0),
    },
  });
}
