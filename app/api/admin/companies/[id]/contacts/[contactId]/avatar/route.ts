import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUpload, bunnyDelete } from '@/lib/bunny';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  await requirePermission('companies.update');
  const { id, contactId } = await ctx.params;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'unsupported_type', type: file.type }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  const existing = await prisma.companyContact.findUnique({ where: { id: contactId }, select: { avatarStorageKey: true, companyId: true } });
  if (!existing || existing.companyId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1];
  const key = `companies/${id}/contacts/${contactId}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { publicUrl } = await bunnyUpload({ key, body: buf, contentType: file.type });
  if (existing.avatarStorageKey) { try { await bunnyDelete([existing.avatarStorageKey]); } catch {} }

  const contact = await prisma.companyContact.update({
    where: { id: contactId },
    data: { avatarUrl: publicUrl, avatarStorageKey: key },
    select: { id: true, avatarUrl: true, avatarStorageKey: true },
  });
  return NextResponse.json({ contact });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  await requirePermission('companies.update');
  const { id, contactId } = await ctx.params;
  const existing = await prisma.companyContact.findUnique({ where: { id: contactId }, select: { avatarStorageKey: true, companyId: true } });
  if (!existing || existing.companyId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (existing.avatarStorageKey) { try { await bunnyDelete([existing.avatarStorageKey]); } catch {} }
  await prisma.companyContact.update({ where: { id: contactId }, data: { avatarUrl: null, avatarStorageKey: null } });
  return NextResponse.json({ ok: true });
}
