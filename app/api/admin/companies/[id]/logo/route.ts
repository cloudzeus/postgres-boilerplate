import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUpload, bunnyDelete } from '@/lib/bunny';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 4 * 1024 * 1024; // 4MB

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'unsupported_type', type: file.type }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { id }, select: { logoStorageKey: true } });
  if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1];
  const key = `companies/${id}/logo-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { publicUrl } = await bunnyUpload({ key, body: buf, contentType: file.type });

  // Best-effort cleanup of previous logo
  if (company.logoStorageKey) {
    try { await bunnyDelete([company.logoStorageKey]); } catch {}
  }

  const updated = await prisma.company.update({
    where: { id },
    data: { logoUrl: publicUrl, logoStorageKey: key },
    select: { id: true, logoUrl: true, logoStorageKey: true },
  });
  return NextResponse.json({ company: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;
  const company = await prisma.company.findUnique({ where: { id }, select: { logoStorageKey: true } });
  if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (company.logoStorageKey) {
    try { await bunnyDelete([company.logoStorageKey]); } catch {}
  }
  await prisma.company.update({ where: { id }, data: { logoUrl: null, logoStorageKey: null } });
  return NextResponse.json({ ok: true });
}
