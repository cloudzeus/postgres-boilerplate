import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUpload } from '@/lib/bunny';
import {
  searchCompanies, getCompany, getCompanyDocuments, downloadGemiFile,
  mapGemiCompany, GemiError,
} from '@/lib/gemi';
import { resolveKadForActivity } from '@/lib/kad/resolve';

const Schema = z.object({
  arGemi: z.string().regex(/^\d+$/).optional(),
  syncDocuments: z.boolean().optional().default(true),
});

function safeExt(contentType: string, fallback = 'pdf') {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/tiff': 'tif',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[contentType.split(';')[0].trim()] ?? fallback;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.update');
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  const opts = Schema.parse(body ?? {});

  const existing = await prisma.company.findUnique({ where: { id }, select: { afm: true, arGemi: true } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    // Resolve arGemi (string identifier ≥ 12 digits)
    let arGemi: string | undefined = opts.arGemi ?? existing.arGemi ?? undefined;
    if (!arGemi) {
      if (!existing.afm) return NextResponse.json({ error: 'missing_identifier' }, { status: 400 });
      const search = await searchCompanies({ afm: existing.afm, resultsSize: 5 });
      const first = search.results?.[0];
      arGemi = first?.arGemi ? String(first.arGemi) : undefined;
      if (!arGemi) return NextResponse.json({ error: 'gemi_not_found' }, { status: 404 });
    }

    // Fetch company + documents
    const [company, docSet] = await Promise.all([
      getCompany(arGemi),
      opts.syncDocuments ? getCompanyDocuments(arGemi).catch(() => ({ decision: [], publication: [] })) : Promise.resolve({}),
    ]);
    const m = mapGemiCompany(company);

    // Only set lookup FKs if the corresponding rows exist locally — prevents FK errors
    // when ΓΕΜΗ metadata hasn't been refreshed yet.
    const [hasLegal, hasOffice, hasStatus, hasPref, hasMuni] = await Promise.all([
      m.legalTypeId ? prisma.legalType.findUnique({ where: { id: m.legalTypeId }, select: { id: true } }) : null,
      m.gemiOfficeId ? prisma.gemiOfficeRef.findUnique({ where: { id: m.gemiOfficeId }, select: { id: true } }) : null,
      m.companyStatusId ? prisma.companyStatusRef.findUnique({ where: { id: m.companyStatusId }, select: { id: true } }) : null,
      m.prefectureId ? prisma.prefecture.findUnique({ where: { id: m.prefectureId }, select: { id: true } }) : null,
      m.municipalityId ? prisma.municipality.findUnique({ where: { id: m.municipalityId }, select: { id: true } }) : null,
    ]);

    // Update company + replace activities in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id },
        data: {
          arGemi: m.arGemi,
          legalTypeId:     hasLegal  ? m.legalTypeId     : undefined,
          gemiOfficeId:    hasOffice ? m.gemiOfficeId    : undefined,
          companyStatusId: hasStatus ? m.companyStatusId : undefined,
          prefectureId:    hasPref   ? m.prefectureId    : undefined,
          municipalityId:  hasMuni   ? m.municipalityId  : undefined,
          afm: m.afm ?? undefined,
          name: m.name || undefined,
          shortName: m.shortName ?? undefined,
          gemhNumber: m.gemhNumber ?? undefined,
          legalForm: m.legalForm ?? undefined,
          address: m.address ?? undefined,
          city: m.city ?? undefined,
          zip: m.zip ?? undefined,
          country: m.country ?? undefined,
          email: m.email ?? undefined,
          website: m.website ?? undefined,
          foundingDate: m.foundingDate ? new Date(m.foundingDate) : undefined,
          gemiOffice: m.gemiOffice ?? undefined,
          gemiStatus: m.gemiStatus ?? undefined,
          gemiObjective: m.gemiObjective ?? undefined,
          gemiIsBranch: m.gemiIsBranch ?? undefined,
          gemiAutoRegistered: m.gemiAutoRegistered ?? undefined,
          gemiLastStatusChange: m.gemiLastStatusChange ? new Date(m.gemiLastStatusChange) : undefined,
          gemiSyncedAt: new Date(),
          gemiData: company as unknown as object,
          isActive: m.isActive,
        },
      });

      if (m.activities.length > 0) {
        // Resolve incoming AADE-form codes against the canonical KadCode hierarchy.
        // Each activity gets both the dotted code and the digit-only form.
        const resolved = await Promise.all(
          m.activities.map((a) => resolveKadForActivity(a.code, a.description)),
        );
        await tx.companyActivity.deleteMany({ where: { companyId: id } });
        await tx.companyActivity.createMany({
          data: m.activities.map((a, i) => ({
            companyId: id,
            code: resolved[i].code,
            codeWithoutDots: resolved[i].codeWithoutDots,
            codeAade: resolved[i].codeAade,
            description: resolved[i].description,
            kind: a.kind,
            order: a.order ?? i,
          })),
        });
      }
    });

    // Download documents to Bunny and upsert CompanyDocument rows
    let documentsImported = 0;
    let documentsFailed = 0;
    if (opts.syncDocuments) {
      const decisions = (docSet as any).decision ?? [];
      const publications = (docSet as any).publication ?? [];

      for (const d of decisions) {
        if (!d.kak) continue;
        try {
          const existingDoc = await prisma.companyDocument.findUnique({
            where: { companyId_kak: { companyId: id, kak: d.kak } },
            select: { id: true, storageKey: true },
          });
          let storageKey: string | undefined;
          let publicUrl: string | undefined;
          let mimeType: string | undefined;
          let sizeBytes: number | undefined;
          if (d.assemblyDecisionUrl && !existingDoc?.storageKey) {
            const { buffer, contentType } = await downloadGemiFile(d.assemblyDecisionUrl);
            mimeType = contentType;
            sizeBytes = buffer.byteLength;
            storageKey = `companies/${id}/gemi/${d.kak}.${safeExt(contentType)}`;
            const upload = await bunnyUpload({ key: storageKey, body: buffer, contentType });
            publicUrl = upload.publicUrl;
          }
          await prisma.companyDocument.upsert({
            where: { companyId_kak: { companyId: id, kak: d.kak } },
            update: {
              kind: 'DECISION',
              title: d.decisionSubject || d.summary || `Απόφαση ${d.kak}`,
              assembly: d.assembly ?? null,
              summary: d.summary ?? null,
              decisionSubject: d.decisionSubject ?? null,
              dateAssemblyDecided: d.dateAssemblyDecided ? new Date(d.dateAssemblyDecided) : null,
              dateAnnounced: d.dateAnnounced ? new Date(d.dateAnnounced) : null,
              dateRegistrated: d.dateRegistrated ? new Date(d.dateRegistrated) : null,
              applicationStatus: d.applicationStatusDescription ?? null,
              sourceUrl: d.assemblyDecisionUrl ?? null,
              ...(storageKey ? { storageKey, publicUrl, mimeType, sizeBytes } : {}),
              metadata: d,
            },
            create: {
              companyId: id, source: 'GEMI', kind: 'DECISION',
              kak: d.kak,
              title: d.decisionSubject || d.summary || `Απόφαση ${d.kak}`,
              assembly: d.assembly ?? null,
              summary: d.summary ?? null,
              decisionSubject: d.decisionSubject ?? null,
              dateAssemblyDecided: d.dateAssemblyDecided ? new Date(d.dateAssemblyDecided) : null,
              dateAnnounced: d.dateAnnounced ? new Date(d.dateAnnounced) : null,
              dateRegistrated: d.dateRegistrated ? new Date(d.dateRegistrated) : null,
              applicationStatus: d.applicationStatusDescription ?? null,
              sourceUrl: d.assemblyDecisionUrl ?? null,
              storageKey, publicUrl, mimeType, sizeBytes,
              metadata: d,
            },
          });
          documentsImported++;
        } catch (e) {
          documentsFailed++;
          console.error('[gemi-sync] decision import failed', d.kak, e);
        }
      }

      for (const p of publications) {
        if (!p.kad) continue;
        try {
          const existingDoc = await prisma.companyDocument.findUnique({
            where: { companyId_kak: { companyId: id, kak: p.kad } },
            select: { id: true, storageKey: true },
          });
          let storageKey: string | undefined;
          let publicUrl: string | undefined;
          let mimeType: string | undefined;
          let sizeBytes: number | undefined;
          if (p.url && !existingDoc?.storageKey) {
            const { buffer, contentType } = await downloadGemiFile(p.url);
            mimeType = contentType;
            sizeBytes = buffer.byteLength;
            storageKey = `companies/${id}/gemi/pub-${p.kad}.${safeExt(contentType)}`;
            const upload = await bunnyUpload({ key: storageKey, body: buffer, contentType });
            publicUrl = upload.publicUrl;
          }
          await prisma.companyDocument.upsert({
            where: { companyId_kak: { companyId: id, kak: p.kad } },
            update: {
              kind: 'PUBLICATION',
              title: `Δημοσίευση ΥΜΣ ${p.kad}`,
              sourceUrl: p.url ?? null,
              ...(storageKey ? { storageKey, publicUrl, mimeType, sizeBytes } : {}),
              metadata: p,
            },
            create: {
              companyId: id, source: 'GEMI', kind: 'PUBLICATION',
              kak: p.kad,
              title: `Δημοσίευση ΥΜΣ ${p.kad}`,
              sourceUrl: p.url ?? null,
              storageKey, publicUrl, mimeType, sizeBytes,
              metadata: p,
            },
          });
          documentsImported++;
        } catch (e) {
          documentsFailed++;
          console.error('[gemi-sync] publication import failed', p.kad, e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      arGemi,
      documentsImported,
      documentsFailed,
    });
  } catch (e) {
    if (e instanceof GemiError) {
      return NextResponse.json({ error: 'gemi_error', status: e.status, message: e.message }, { status: 502 });
    }
    console.error('[gemi-sync] failed', e);
    return NextResponse.json({ error: 'unexpected', message: (e as Error).message }, { status: 500 });
  }
}
