import { FiBriefcase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { CompaniesView } from './companies-view';

export const dynamic = 'force-dynamic';

export default async function AdminCompaniesPage() {
  await requirePermission('companies.read');

  const [companies, types, canManageTypes] = await Promise.all([
    prisma.company.findMany({
      include: {
        types: { include: { type: true } },
        _count: { select: { branches: true, documents: true, contacts: true, activities: true } },
        legalTypeRef: true,
        vatCategoryRef: true,
        gemiOfficeRef: true,
        companyStatusRef: true,
        prefectureRef: true,
        municipalityRef: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.companyType.findMany({
      orderBy: { order: 'asc' },
      include: { _count: { select: { companies: true } } },
    }),
    hasPermission('companies.manage_types'),
  ]);

  const rows = companies.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    shortName: c.shortName,
    afm: c.afm,
    doy: c.doy,
    profession: c.profession,
    legalForm: c.legalForm,
    gemhNumber: c.gemhNumber,
    email: c.email,
    phone: c.phone,
    phone2: c.phone2,
    fax: c.fax,
    website: c.website,
    contactPerson: c.contactPerson,
    contactTitle: c.contactTitle,
    address: c.address,
    city: c.city,
    zip: c.zip,
    country: c.country,
    district: c.district,
    iban: c.iban,
    bankName: c.bankName,
    currency: c.currency,
    paymentTerms: c.paymentTerms,
    creditLimit: c.creditLimit ? Number(c.creditLimit) : null,
    discount: c.discount ? Number(c.discount) : null,
    vatCategory: c.vatCategory,
    vatCategoryId: c.vatCategoryId,
    vatCategoryLabel: c.vatCategoryRef ? `${c.vatCategoryRef.descr}` : null,
    legalTypeId: c.legalTypeId,
    legalTypeLabel: c.legalTypeRef?.descr ?? null,
    gemiOfficeId: c.gemiOfficeId,
    gemiOfficeLabel: c.gemiOfficeRef?.descr ?? null,
    companyStatusId: c.companyStatusId,
    companyStatusLabel: c.companyStatusRef?.descr ?? null,
    prefectureId: c.prefectureId,
    prefectureLabel: c.prefectureRef?.descr ?? null,
    municipalityId: c.municipalityId,
    municipalityLabel: c.municipalityRef?.descr ?? null,
    regionCode: c.regionCode,
    employeeCount: c.employeeCount,
    category: c.category,
    isActive: c.isActive,
    branchCount: c._count.branches,
    documentCount: c._count.documents,
    contactCount: c._count.contacts,
    activityCount: c._count.activities,
    logoUrl: c.logoUrl,
    latitude: c.latitude,
    longitude: c.longitude,
    geocodedAddress: c.geocodedAddress,
    arGemi: c.arGemi,
    gemiStatus: c.gemiStatus,
    gemiOffice: c.gemiOffice,
    aadeStatus: c.aadeStatus,
    aadeFirmKind: c.aadeFirmKind,
    foundingDate: c.foundingDate?.toISOString() ?? null,
    aadeSyncedAt: c.aadeSyncedAt?.toISOString() ?? null,
    gemiSyncedAt: c.gemiSyncedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    typeIds: c.types.map((t) => t.typeId),
    typeKeys: c.types.map((t) => t.type.key),
    typeLabels: c.types.map((t) => ({ id: t.typeId, name: t.type.name, color: t.type.color })),
  }));

  const typeOptions = types.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    pluralName: t.pluralName ?? t.name,
    color: t.color,
    isSystem: t.isSystem,
    count: t._count.companies,
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBriefcase />}
        title="Εταιρίες"
        description="Διαχείριση πελατών, προμηθευτών και συνεργατών. Μια εταιρία μπορεί να ανήκει σε πολλούς τύπους ταυτόχρονα."
      />
      <CompaniesView rows={rows} types={typeOptions} canManageTypes={canManageTypes} />
    </div>
  );
}
