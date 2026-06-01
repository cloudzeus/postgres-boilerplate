import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Generic read-only feed for reference registries that have no dedicated admin
// page — consumed by the "Προβολή" modal on /admin/reference-data.
type Column = { key: string; label: string };
type Payload = { title: string; columns: Column[]; rows: Record<string, unknown>[] };

export async function GET(req: Request) {
  await requirePermission('metadata.read');
  const key = new URL(req.url).searchParams.get('key') ?? '';

  let data: Payload | null = null;

  switch (key) {
    case 'legalTypes': {
      const rows = await prisma.legalType.findMany({ orderBy: { descr: 'asc' } });
      data = {
        title: 'Νομικές μορφές',
        columns: [
          { key: 'id', label: 'Κωδ.' },
          { key: 'descr', label: 'Περιγραφή' },
          { key: 'descrEn', label: 'Description (EN)' },
        ],
        rows: rows.map((r) => ({ id: r.id, descr: r.descr, descrEn: r.descrEn ?? '' })),
      };
      break;
    }
    case 'gemiOffices': {
      const rows = await prisma.gemiOfficeRef.findMany({ orderBy: { descr: 'asc' } });
      data = {
        title: 'Υπηρεσίες ΓΕΜΗ',
        columns: [
          { key: 'id', label: 'Κωδ.' },
          { key: 'descr', label: 'Περιγραφή' },
          { key: 'city', label: 'Πόλη' },
          { key: 'phone', label: 'Τηλέφωνο' },
        ],
        rows: rows.map((r) => ({ id: r.id, descr: r.descr, city: r.city ?? '', phone: r.phone ?? '' })),
      };
      break;
    }
    case 'companyStatuses': {
      const rows = await prisma.companyStatusRef.findMany({ orderBy: { descr: 'asc' } });
      data = {
        title: 'Καταστάσεις εταιρίας',
        columns: [
          { key: 'id', label: 'Κωδ.' },
          { key: 'descr', label: 'Περιγραφή' },
          { key: 'isActive', label: 'Ενεργό' },
        ],
        rows: rows.map((r) => ({ id: r.id, descr: r.descr, isActive: r.isActive ? 'Ναι' : 'Όχι' })),
      };
      break;
    }
    case 'customers':
    case 'suppliers': {
      const isCust = key === 'customers';
      const list = isCust
        ? await prisma.softoneCustomer.findMany({ orderBy: { name: 'asc' } })
        : await prisma.softoneSupplier.findMany({ orderBy: { name: 'asc' } });
      data = {
        title: isCust ? 'Πελάτες' : 'Προμηθευτές',
        columns: [
          { key: 'code', label: 'Κωδικός' },
          { key: 'name', label: 'Επωνυμία' },
          { key: 'afm', label: 'Α.Φ.Μ.' },
          { key: 'city', label: 'Πόλη/Περιοχή' },
          { key: 'phone', label: 'Τηλέφωνο' },
          { key: 'email', label: 'Email' },
        ],
        rows: list.map((r) => ({
          code: r.code,
          name: r.name,
          afm: r.afm ?? '',
          city: r.city || r.district || '',
          phone: r.phone ?? '',
          email: r.email ?? '',
        })),
      };
      break;
    }
    case 'purchaseDocTypes': {
      const rows = await prisma.purchaseDocType.findMany({ orderBy: [{ order: 'asc' }, { code: 'asc' }] });
      data = {
        title: 'Τύποι παραστατικών αγορών',
        columns: [
          { key: 'code', label: 'Σειρά' },
          { key: 'abbrev', label: 'Σύντμηση' },
          { key: 'name', label: 'Περιγραφή' },
          { key: 'section', label: 'Τύπος' },
          { key: 'isActive', label: 'Ενεργό' },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          abbrev: r.abbrev ?? '',
          name: r.name,
          section: r.section ?? '',
          isActive: r.isActive ? 'Ναι' : 'Όχι',
        })),
      };
      break;
    }
    case 'vatCategories': {
      const rows = await prisma.vatCategory.findMany({ orderBy: [{ order: 'asc' }, { code: 'asc' }] });
      data = {
        title: 'Κατηγορίες ΦΠΑ',
        columns: [
          { key: 'code', label: 'Κωδ.' },
          { key: 'descr', label: 'Περιγραφή' },
          { key: 'rate', label: 'Ποσοστό %' },
          { key: 'isActive', label: 'Ενεργό' },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          descr: r.descr,
          rate: r.rate == null ? '' : r.rate,
          isActive: r.isActive ? 'Ναι' : 'Όχι',
        })),
      };
      break;
    }
  }

  if (!data) return NextResponse.json({ error: 'unknown_registry' }, { status: 404 });
  return NextResponse.json(data);
}
