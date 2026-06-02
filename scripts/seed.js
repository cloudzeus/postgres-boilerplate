import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable for Prisma');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Keep in sync with lib/permissions.ts
const PERMISSIONS = [
  { key: 'users.read', resource: 'users', action: 'read', description: 'View users' },
  { key: 'users.create', resource: 'users', action: 'create', description: 'Create users' },
  { key: 'users.update', resource: 'users', action: 'update', description: 'Update users' },
  { key: 'users.delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { key: 'users.assign_role', resource: 'users', action: 'assign_role', description: 'Assign role to user' },
  { key: 'roles.read', resource: 'roles', action: 'read', description: 'View roles' },
  { key: 'roles.create', resource: 'roles', action: 'create', description: 'Create roles' },
  { key: 'roles.update', resource: 'roles', action: 'update', description: 'Update roles' },
  { key: 'roles.delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { key: 'roles.reorder', resource: 'roles', action: 'reorder', description: 'Reorder roles' },
  { key: 'permissions.read', resource: 'permissions', action: 'read', description: 'View permissions' },
  { key: 'permissions.assign', resource: 'permissions', action: 'assign', description: 'Grant/revoke permissions' },
  { key: 'permissions.reorder', resource: 'permissions', action: 'reorder', description: 'Reorder permissions' },
  { key: 'imports.read', resource: 'imports', action: 'read', description: 'View Excel imports' },
  { key: 'imports.create', resource: 'imports', action: 'create', description: 'Upload Excel imports' },
  { key: 'system.audit', resource: 'system', action: 'audit', description: 'View audit log' },
  { key: 'system.settings', resource: 'system', action: 'settings', description: 'Modify system settings' },
  { key: 'system.backups', resource: 'system', action: 'backups', description: 'Manage database backups' },
  { key: 'media.read', resource: 'media', action: 'read', description: 'View media gallery' },
  { key: 'media.upload', resource: 'media', action: 'upload', description: 'Upload media files' },
  { key: 'media.delete', resource: 'media', action: 'delete', description: 'Delete media files/folders' },
  { key: 'media.manage_folders', resource: 'media', action: 'manage_folders', description: 'Create/rename folders' },
  { key: 'companies.read', resource: 'companies', action: 'read', description: 'View companies' },
  { key: 'companies.create', resource: 'companies', action: 'create', description: 'Create companies' },
  { key: 'companies.update', resource: 'companies', action: 'update', description: 'Update companies' },
  { key: 'companies.delete', resource: 'companies', action: 'delete', description: 'Delete companies' },
  { key: 'companies.manage_types', resource: 'companies', action: 'manage_types', description: 'Manage company types (sodtype)' },
  { key: 'kad.read', resource: 'kad', action: 'read', description: 'View ΚΑΔ registry' },
  { key: 'kad.manage', resource: 'kad', action: 'manage', description: 'Create/update ΚΑΔ master entries' },
  { key: 'metadata.read', resource: 'metadata', action: 'read', description: 'View reference lookup tables' },
  { key: 'metadata.manage', resource: 'metadata', action: 'manage', description: 'Refresh ΓΕΜΗ metadata + edit lookups' },
  { key: 'ocr.read', resource: 'ocr', action: 'read', description: 'View OCR documents' },
  { key: 'ocr.create', resource: 'ocr', action: 'create', description: 'Upload & extract documents' },
  { key: 'ocr.delete', resource: 'ocr', action: 'delete', description: 'Delete OCR documents' },
  { key: 'ocr.categorize', resource: 'ocr', action: 'categorize', description: 'Set category / notes on OCR documents' },
  { key: 'ocr.post', resource: 'ocr', action: 'post', description: 'Post OCR document to SoftOne' },
  { key: 'programs.read',   resource: 'programs', action: 'read',   description: 'View European funding programs' },
  { key: 'programs.create', resource: 'programs', action: 'create', description: 'Upload & extract program PDFs' },
  { key: 'programs.update', resource: 'programs', action: 'update', description: 'Edit extracted program data' },
  { key: 'programs.delete', resource: 'programs', action: 'delete', description: 'Delete programs' },
];

const BUSINESS_TYPES = [
  { code: 'ΑΕ',            name: 'Ανώνυμη Εταιρεία (Α.Ε.)',                 order: 1 },
  { code: 'ΕΠΕ',           name: 'Εταιρεία Περιορισμένης Ευθύνης (Ε.Π.Ε.)', order: 2 },
  { code: 'ΙΚΕ',           name: 'Ιδιωτική Κεφαλαιουχική Εταιρεία (Ι.Κ.Ε.)', order: 3 },
  { code: 'ΟΕ',            name: 'Ομόρρυθμη Εταιρεία (Ο.Ε.)',               order: 4 },
  { code: 'ΕΕ',            name: 'Ετερόρρυθμη Εταιρεία (Ε.Ε.)',             order: 5 },
  { code: 'ΑΤΟΜΙΚΗ',       name: 'Ατομική Επιχείρηση',                      order: 6 },
  { code: 'ΣΥΝΕΤΑΙΡΙΣΜΟΣ', name: 'Συνεταιρισμός',                           order: 7 },
  { code: 'ΚΟΙΝΣΕΠ',       name: 'Κοιν.Σ.Επ.',                              order: 8 },
  { code: 'ΚΟΙΣΠΕ',        name: 'Κοι.Σ.Π.Ε.',                              order: 9 },
  { code: 'ΑΜΚΕ',          name: 'Αστική Μη Κερδοσκοπική Εταιρεία',         order: 10 },
];

const VAT_CATEGORIES = [
  { code: 'NORMAL', descr: 'Κανονικό (24%)', rate: 24, order: 0 },
  { code: 'REDUCED', descr: 'Μειωμένο (13%)', rate: 13, order: 1 },
  { code: 'SUPER_REDUCED', descr: 'Υπερμειωμένο (6%)', rate: 6, order: 2 },
  { code: 'ZERO', descr: 'Μηδενικός (0%)', rate: 0, order: 3 },
  { code: 'EXEMPT', descr: 'Απαλλασσόμενο ΦΠΑ', rate: null, order: 4 },
  { code: 'NON_VAT', descr: 'Εκτός πεδίου ΦΠΑ', rate: null, order: 5 },
  { code: 'REVERSE_CHARGE', descr: 'Αντιστροφή υποχρέωσης', rate: null, order: 6 },
  { code: 'INTRA_COMMUNITY', descr: 'Ενδοκοινοτική συναλλαγή', rate: null, order: 7 },
];

const SYSTEM_COMPANY_TYPES = [
  { key: 'CUSTOMER', name: 'Πελάτης', pluralName: 'Πελάτες', color: '#2563eb', icon: 'FiUser', order: 0, sodtype: 13 },
  { key: 'SUPPLIER', name: 'Προμηθευτής', pluralName: 'Προμηθευτές', color: '#16a34a', icon: 'FiTruck', order: 1, sodtype: 12 },
  { key: 'PARTNER', name: 'Συνεργάτης', pluralName: 'Συνεργάτες', color: '#9333ea', icon: 'FiUsers', order: 2, sodtype: null },
  { key: 'PROSPECT', name: 'Δυνητικός Πελάτης', pluralName: 'Δυνητικοί Πελάτες', color: '#f59e0b', icon: 'FiTarget', order: 3, sodtype: null },
];

const SYSTEM_ROLES = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Πλήρης πρόσβαση στο σύστημα', order: 0 },
  { key: 'ADMIN', name: 'Administrator', description: 'Διαχείριση χρηστών και ομάδων', order: 1 },
  { key: 'EMPLOYEE', name: 'Employee', description: 'Εσωτερικός χρήστης', order: 2 },
  { key: 'COLLABORATOR', name: 'Collaborator', description: 'Εξωτερικός συνεργάτης', order: 3 },
  { key: 'SUPPLIER', name: 'Supplier', description: 'Προμηθευτής', order: 4 },
  { key: 'CUSTOMER', name: 'Customer', description: 'Πελάτης', order: 5 },
];

const ROLE_DEFAULTS = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  ADMIN: ['users.read', 'users.create', 'users.update', 'users.assign_role', 'roles.read', 'permissions.read', 'imports.read', 'imports.create', 'companies.read', 'companies.create', 'companies.update', 'companies.delete', 'companies.manage_types', 'kad.read', 'kad.manage', 'metadata.read', 'metadata.manage', 'ocr.read', 'ocr.create', 'ocr.delete', 'ocr.categorize', 'ocr.post', 'programs.read', 'programs.create', 'programs.update', 'programs.delete'],
  EMPLOYEE: ['users.read', 'imports.read', 'imports.create'],
  COLLABORATOR: ['users.read', 'imports.read'],
  SUPPLIER: ['imports.read'],
  CUSTOMER: [],
};

async function seedPermissions() {
  for (let i = 0; i < PERMISSIONS.length; i++) {
    const p = PERMISSIONS[i];
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, description: p.description, order: i },
      create: { key: p.key, resource: p.resource, action: p.action, description: p.description, order: i },
    });
  }
  console.log(`✓ Seeded ${PERMISSIONS.length} permissions`);
}

async function seedRoles() {
  for (const r of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, order: r.order, isSystem: true, key: r.key },
      create: { key: r.key, name: r.name, description: r.description, order: r.order, isSystem: true },
    });
  }
  console.log(`✓ Seeded ${SYSTEM_ROLES.length} system roles`);
}

async function seedRolePermissions() {
  for (const [roleKey, keys] of Object.entries(ROLE_DEFAULTS)) {
    const role = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) continue;
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }
  console.log('✓ Linked role → permission defaults');
}

async function seedSuperAdmin() {
  const email = 'gkozyris@i4ria.com';
  const password = '1f1femsk';
  const name = 'Giorgos Kozyris';
  const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  if (!role) throw new Error('SUPER_ADMIN role missing');

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { roleId: role.id, name, isActive: true, emailVerified: existing.emailVerified ?? new Date() },
    });
    console.log('✓ Super admin updated:', email);
    return;
  }
  await prisma.user.create({
    data: { email, name, passwordHash, emailVerified: new Date(), roleId: role.id, isActive: true },
  });
  console.log('✓ Seeded super admin:', email);
}

async function seedCompanyTypes() {
  for (const t of SYSTEM_COMPANY_TYPES) {
    await prisma.companyType.upsert({
      where: { key: t.key },
      update: { name: t.name, pluralName: t.pluralName, color: t.color, icon: t.icon, order: t.order, isSystem: true },
      create: { key: t.key, name: t.name, pluralName: t.pluralName, color: t.color, icon: t.icon, order: t.order, isSystem: true },
    });
  }
  console.log(`✓ Seeded ${SYSTEM_COMPANY_TYPES.length} system company types`);
}

async function seedBusinessTypes() {
  for (const b of BUSINESS_TYPES) {
    await prisma.businessType.upsert({
      where: { code: b.code },
      update: { name: b.name, order: b.order },
      create: { code: b.code, name: b.name, order: b.order, active: true },
    });
  }
  console.log(`✓ Seeded ${BUSINESS_TYPES.length} business types`);
}

async function seedVatCategories() {
  for (const v of VAT_CATEGORIES) {
    await prisma.vatCategory.upsert({
      where: { code: v.code },
      update: { descr: v.descr, rate: v.rate, order: v.order },
      create: { code: v.code, descr: v.descr, rate: v.rate, order: v.order, isActive: true },
    });
  }
  console.log(`✓ Seeded ${VAT_CATEGORIES.length} VAT categories`);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedRolePermissions();
  await seedSuperAdmin();
  await seedCompanyTypes();
  await seedVatCategories();
  await seedBusinessTypes();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
