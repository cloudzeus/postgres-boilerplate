import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { isValidLocale, LOCALES } from '@/i18n/locales';

const PatchSchema = z.object({
  locale: z.string().optional(),
  preferredLocales: z.array(z.string()).optional(),
});

export async function PATCH(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const data: { locale?: string; preferredLocales?: string[] } = {};
  if (parsed.data.locale && isValidLocale(parsed.data.locale)) data.locale = parsed.data.locale;
  if (parsed.data.preferredLocales) {
    data.preferredLocales = parsed.data.preferredLocales.filter(isValidLocale);
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 });

  await prisma.user.update({ where: { id: me.id }, data });

  // Also set cookie so next-intl picks it up immediately
  if (data.locale) {
    const jar = await cookies();
    jar.set('dg-locale', data.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ locales: LOCALES });
}
