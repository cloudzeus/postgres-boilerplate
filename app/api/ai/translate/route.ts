import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/rbac';
import { translateText, translateBatch } from '@/lib/deepseek';

const Body = z.object({
  text: z.string().optional(),
  texts: z.array(z.string()).optional(),
  from: z.string().optional(),
  to: z.string().min(2),
}).refine((d) => !!d.text || (d.texts && d.texts.length > 0), { message: 'text or texts required' });

export async function POST(req: Request) {
  await requireUser();
  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  try {
    if (parsed.data.texts && parsed.data.texts.length > 0) {
      const translations = await translateBatch(parsed.data.texts, parsed.data.to, parsed.data.from ?? 'auto');
      return NextResponse.json({ translations });
    }
    const translated = await translateText(parsed.data.text!, parsed.data.to, parsed.data.from ?? 'auto');
    return NextResponse.json({ translated });
  } catch (err) {
    return NextResponse.json({ error: 'deepseek_error', message: (err as Error).message }, { status: 500 });
  }
}
