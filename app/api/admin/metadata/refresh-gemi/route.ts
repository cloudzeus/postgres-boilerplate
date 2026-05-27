import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { metadata, GemiError } from '@/lib/gemi';

export async function POST() {
  await requirePermission('metadata.manage');

  try {
    const [legalTypes, gemiOffices, statuses, prefectures, municipalities] = await Promise.all([
      metadata.legalTypes(),
      metadata.gemiOffices(),
      metadata.companyStatuses(),
      metadata.prefectures(),
      metadata.municipalities(),
    ]);

    const summary: Record<string, number> = {};

    // ΓΕΜΗ returns numeric ids as strings — coerce here.
    const toInt = (v: any) => typeof v === 'number' ? v : parseInt(String(v), 10);

    // LegalType
    await Promise.all(legalTypes.map((t) => {
      const id = toInt(t.id);
      return prisma.legalType.upsert({
        where: { id },
        update: { descr: t.descr, descrEn: t.descrEn ?? null, lastUpdated: t.lastUpdated ? new Date(t.lastUpdated) : null },
        create: { id, descr: t.descr, descrEn: t.descrEn ?? null, lastUpdated: t.lastUpdated ? new Date(t.lastUpdated) : null },
      });
    }));
    summary.legalTypes = legalTypes.length;

    // GemiOffice
    await Promise.all(gemiOffices.map((o) => {
      const id = toInt(o.id);
      return prisma.gemiOfficeRef.upsert({
        where: { id },
        update: {
          descr: o.descr, descrEn: o.descrEn ?? null,
          address: o.address ?? null, city: o.city ?? null, zipCode: o.zipCode ?? null,
          phone: o.phone ?? null, fax: o.fax ?? null, url: o.url ?? null,
          lastUpdated: o.lastUpdated ? new Date(o.lastUpdated) : null,
        },
        create: {
          id, descr: o.descr, descrEn: o.descrEn ?? null,
          address: o.address ?? null, city: o.city ?? null, zipCode: o.zipCode ?? null,
          phone: o.phone ?? null, fax: o.fax ?? null, url: o.url ?? null,
          lastUpdated: o.lastUpdated ? new Date(o.lastUpdated) : null,
        },
      });
    }));
    summary.gemiOffices = gemiOffices.length;

    // CompanyStatus
    await Promise.all(statuses.map((s) => {
      const id = toInt(s.id);
      return prisma.companyStatusRef.upsert({
        where: { id },
        update: { descr: s.descr, descrEn: s.descrEn ?? null, isActive: s.isActive, lastUpdated: s.lastUpdated ? new Date(s.lastUpdated) : null },
        create: { id, descr: s.descr, descrEn: s.descrEn ?? null, isActive: s.isActive, lastUpdated: s.lastUpdated ? new Date(s.lastUpdated) : null },
      });
    }));
    summary.companyStatuses = statuses.length;

    // Prefecture
    await Promise.all(prefectures.map((p) =>
      prisma.prefecture.upsert({
        where: { id: p.id },
        update: { descr: p.descr, descrEn: p.descrEn ?? null, lastUpdated: p.lastUpdated ? new Date(p.lastUpdated) : null },
        create: { id: p.id, descr: p.descr, descrEn: p.descrEn ?? null, lastUpdated: p.lastUpdated ? new Date(p.lastUpdated) : null },
      }),
    ));
    summary.prefectures = prefectures.length;

    // Municipality (must come after Prefecture due to FK)
    await Promise.all(municipalities.map((m) =>
      prisma.municipality.upsert({
        where: { id: m.id },
        update: { descr: m.descr, descrEn: m.descrEn ?? null, prefectureId: m.prefectureId ?? null, lastUpdated: m.lastUpdated ? new Date(m.lastUpdated) : null },
        create: { id: m.id, descr: m.descr, descrEn: m.descrEn ?? null, prefectureId: m.prefectureId ?? null, lastUpdated: m.lastUpdated ? new Date(m.lastUpdated) : null },
      }),
    ));
    summary.municipalities = municipalities.length;

    return NextResponse.json({ ok: true, refreshedAt: new Date().toISOString(), summary });
  } catch (e) {
    if (e instanceof GemiError) {
      return NextResponse.json({ error: 'gemi_error', status: e.status, message: e.message }, { status: 502 });
    }
    console.error('[metadata/refresh-gemi] failed', e);
    return NextResponse.json({ error: 'unexpected', message: (e as Error).message }, { status: 500 });
  }
}
