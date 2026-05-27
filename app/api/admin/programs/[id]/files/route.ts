import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const VALID_KINDS = ['MAIN', 'ANNEX', 'CLARIFICATION', 'AMENDMENT', 'OTHER'] as const;

function sanitize(name: string) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase() || 'file';
}

// GET — list of files on a program
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const files = await prisma.programFile.findMany({
    where: { programId: id },
    orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }],
  });
  return NextResponse.json({ data: files });
}

// POST — attach a new file (ANNEX / CLARIFICATION / etc.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('programs.create');
  const { id } = await params;

  const program = await prisma.program.findUnique({ where: { id } });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  const kindRaw = String(form.get('kind') ?? 'ANNEX');
  const label = String(form.get('label') ?? '').trim() || null;
  const kind = (VALID_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as any) : 'OTHER';

  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (!ALLOWED_MIMES.has(file.type)) return NextResponse.json({ error: `Unsupported: ${file.type}` }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const safe = sanitize(file.name);
  const ext = safe.includes('.') ? safe.slice(safe.lastIndexOf('.')) : '';
  const stem = safe.replace(ext, '').slice(0, 60) || 'file';
  const d = new Date();
  const storageKey = `programs/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${slug()}-${stem}${ext}`;
  await bunnyUploadPrivate({ key: storageKey, body: buffer, contentType: file.type });

  const row = await prisma.programFile.create({
    data: {
      programId: id,
      fileName: file.name,
      storageKey,
      publicUrl: `bunny:${storageKey}`,
      mimeType: file.type,
      size: file.size,
      kind,
      label,
      uploadedById: user.id,
    },
  });

  return NextResponse.json({ file: row }, { status: 201 });
}
