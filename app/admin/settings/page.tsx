import { FiSettings } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { SETTING_CATALOG, SETTING_CATEGORIES, maskSecret } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  await requirePermission('system.settings');
  const rows = await prisma.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const items = SETTING_CATALOG.map((def) => {
    const raw = map.get(def.key) ?? def.defaultValue ?? null;
    return {
      key: def.key,
      category: def.category,
      label: def.label,
      description: def.description,
      type: def.type,
      isSecret: !!def.isSecret,
      value: def.isSecret && typeof raw === 'string' && raw ? maskSecret(raw) : raw,
      hasValue: map.has(def.key),
    };
  });

  return (
    <div className="w-full max-w-5xl">
      <PageHeader
        icon={<FiSettings />}
        title="Ρυθμίσεις"
        description="Στοιχεία εταιρίας, διασυνδέσεις τρίτων, API keys και AI providers."
      />
      <SettingsForm
        items={items}
        categories={SETTING_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
      />
    </div>
  );
}
