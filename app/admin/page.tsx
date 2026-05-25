import { FiUsers, FiShield, FiKey, FiUpload, FiActivity } from 'react-icons/fi';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';

export default async function AdminHomePage() {
  const user = await requireUser();
  const [userCount, roleCount, permissionCount, importCount] = await Promise.all([
    prisma.user.count(),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.excelImport.count(),
  ]);

  const stats = [
    { label: 'Χρήστες', value: userCount, icon: FiUsers, href: '/admin/users' },
    { label: 'Ρόλοι', value: roleCount, icon: FiShield, href: '/admin/roles' },
    { label: 'Δικαιώματα', value: permissionCount, icon: FiKey, href: '/admin/permissions' },
    { label: 'Imports', value: importCount, icon: FiUpload, href: '/admin/imports' },
  ];

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiActivity />}
        title={`Καλώς ήρθες, ${user.name?.split(' ')[0] ?? user.email}`}
        description="Επισκόπηση συστήματος και πρόσφατη δραστηριότητα."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="cx-card p-4 cx-transition hover:shadow-fluent-4 hover:-translate-y-0.5 block"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--cx-accent-soft)] text-primary [&_svg]:size-4">
                <s.icon />
              </span>
            </div>
            <div className="mt-3 text-[24px] font-semibold tabular-nums text-foreground leading-none">{s.value}</div>
            <div className="mt-1 text-body-sm text-muted-foreground">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-3">
        <div className="cx-card p-5">
          <h3 className="text-subtitle text-foreground mb-2">Επόμενα βήματα</h3>
          <ol className="space-y-1.5 text-body text-muted-foreground list-decimal list-inside">
            <li>Διαμόρφωσε τους ρόλους στο <Link href="/admin/roles" className="text-primary hover:underline">Ρόλοι</Link></li>
            <li>Πρόσθεσε χρήστες στο <Link href="/admin/users" className="text-primary hover:underline">Χρήστες</Link></li>
            <li>Συνέχισε με τα modules του ERP</li>
          </ol>
        </div>
        <div className="cx-card p-5">
          <h3 className="text-subtitle text-foreground mb-2">Σύστημα</h3>
          <dl className="space-y-1.5 text-body-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Next.js</dt><dd className="font-mono text-foreground">16.2</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Prisma</dt><dd className="font-mono text-foreground">7.x</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">DB</dt><dd className="font-mono text-foreground">PostgreSQL</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}
