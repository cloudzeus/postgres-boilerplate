import { requireUser } from '@/lib/rbac';
import { AdminSidebar, AdminBottomNav } from '@/components/admin/sidebar';
import { DEFAULT_LOCALE, isValidLocale, type LocaleCode } from '@/i18n/locales';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const permissionKeys = Array.from(user.permissionKeys);
  const locale: LocaleCode = isValidLocale(user.locale) ? user.locale : DEFAULT_LOCALE;

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar
        user={{ name: user.name, email: user.email }}
        roleName={user.role.name}
        roleKey={user.role.key ?? null}
        locale={locale}
        permissionKeys={permissionKeys}
      />
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        <main className="flex-1 p-4 lg:p-6 animate-fade-in">{children}</main>
      </div>
      <AdminBottomNav />
    </div>
  );
}
